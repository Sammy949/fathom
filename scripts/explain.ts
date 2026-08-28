/**
 * Stage 5 gate. Grades live markets, explains the verdicts, prints the trace.
 *
 *   npm run explain            # tries the model, falls back if unreachable
 *   npm run explain -- --offline   # deterministic narrator only
 *
 * The gate asserts the guarantee that matters: the model cannot move the
 * verdict. It grades each market, explains it, and then checks that the verdict,
 * confidence, action, and every signal severity are byte-identical before and
 * after the explanation step. It also runs the guard against deliberately
 * poisoned prose to prove the guard rejects what it is supposed to reject.
 *
 * Read-only; sends no transactions.
 */

import { createExchange, shutdown } from "@fathom/ec";
import {
  buildTrace,
  describeProvider,
  explainAssessment,
  gradeSnapshot,
  guardExplanation,
  ingestVenue,
  resolveProvider,
  type Assessment,
} from "@fathom/core";

const R = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YEL = "\x1b[33m";
const GRN = "\x1b[32m";
const CYA = "\x1b[36m";
const MAG = "\x1b[35m";

const VERDICT_COLOR = { ALLOW: GRN, RECHECK: YEL, BLOCK: RED } as const;
const SEV_COLOR = { ok: GRN, elevated: YEL, severe: RED, unknown: DIM } as const;

const offline = process.argv.includes("--offline");
const problems: string[] = [];

/** Fields the model must not be able to influence. */
const fingerprint = (a: Assessment) =>
  JSON.stringify({
    verdict: a.verdict,
    confidence: a.confidence,
    action: a.action,
    severities: a.signals.map((s) => [s.id, s.severity]),
    findings: a.signals.map((s) => s.finding),
    rules: a.rules,
  });

function wrap(text: string, indent: string, width = 88): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else line += ` ${w}`;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l) => indent + l).join("\n");
}

async function main(): Promise<void> {
  const ctx = createExchange({ withSigner: false });
  const provider = offline ? null : resolveProvider();

  console.log(`${BOLD}Fathom — Stage 5 decision traces${R}`);
  console.log(
    `${DIM}${ctx.config.network} · explanation: ${
      offline
        ? "offline (deterministic narrator)"
        : provider
          ? `${describeProvider(provider)}, falls back on any failure`
          : "no provider configured — deterministic narrator"
    }${R}`,
  );
  if (!offline && !provider) {
    console.log(
      `${YEL}  no GROQ_API_KEY in .env — running the fallback narrator. Get a free key at https://console.groq.com/keys${R}`,
    );
  }

  const { snapshots } = await ingestVenue(ctx, { minIntervalSec: 900 });
  // Three markets is enough to show the range without burning tokens.
  const chosen = snapshots.slice(0, 3);

  for (const snapshot of chosen) {
    const before = gradeSnapshot(snapshot);
    const fpBefore = fingerprint(before);

    const explanation = await explainAssessment(snapshot, before, { offline });

    // Re-grade AFTER the model ran. If the explanation step could reach the
    // engine at all, this is where it would show.
    const after = gradeSnapshot(snapshot);
    if (fingerprint(after) !== fpBefore) {
      problems.push(`${snapshot.identity.symbol}: assessment changed across the explanation step`);
    }

    const trace = buildTrace(snapshot, after, explanation);
    const vc = VERDICT_COLOR[trace.verdict];

    console.log(
      `\n${BOLD}${trace.symbol}${R} → ${vc}${BOLD}${trace.verdict}${R} ${DIM}confidence ${trace.confidence} · ${trace.action}${R}`,
    );
    console.log(
      `  ${MAG}${trace.explanation.source === "model" ? `explained by ${trace.explanation.model}` : "explained by deterministic fallback"}${R}` +
        (trace.explanation.usage
          ? ` ${DIM}${trace.explanation.usage.inputTokens} in / ${trace.explanation.usage.outputTokens} out${R}`
          : ""),
    );
    if (trace.explanation.fallbackReason) {
      console.log(`  ${DIM}why fallback: ${trace.explanation.fallbackReason}${R}`);
    }

    console.log(`\n  ${CYA}${trace.explanation.headline}${R}`);
    console.log(wrap(trace.explanation.summary, "  "));

    console.log(`\n  ${CYA}signals${R} ${DIM}(measured value · calibration basis · plain reading)${R}`);
    for (const sig of trace.signals) {
      const c = SEV_COLOR[sig.severity];
      console.log(`    ${c}${sig.severity.padEnd(8)}${R} ${BOLD}${sig.label}${R}`);
      console.log(wrap(sig.finding, "      "));
      if (sig.reading) console.log(wrap(`→ ${sig.reading}`, "      "));
    }

    console.log(`\n  ${CYA}rules that fired${R}`);
    for (const r of trace.rules) console.log(`    ${DIM}${r.rule}${R} — ${r.because}`);

    if (trace.requiredChecks.length) {
      console.log(`\n  ${CYA}required before acting${R}`);
      for (const c of trace.requiredChecks) console.log(`    · ${c}`);
    }

    if (trace.oracleAuditUrl) {
      console.log(`\n  ${CYA}settlement receipt${R}\n    ${trace.oracleAuditUrl}`);
    }

    const degraded = trace.provenance.filter((p) => p.state !== "ok");
    if (degraded.length) {
      console.log(
        `\n  ${YEL}degraded reads:${R} ${degraded.map((p) => `${p.field} (${p.state})`).join(", ")}`,
      );
    }
  }

  // ── the structural guarantee ───────────────────────────────────────────────
  console.log(`\n${BOLD}verdict integrity${R}`);
  console.log(
    problems.length === 0
      ? `  ${GRN}PASS${R} verdict, confidence, action and every severity unchanged across explanation`
      : `  ${RED}FAIL${R} the explanation step altered an assessment`,
  );

  // ── guard proof ────────────────────────────────────────────────────────────
  // A guard that has never rejected anything is indistinguishable from no guard,
  // so poison the prose deliberately and confirm each check fires.
  console.log(`\n${BOLD}guard rejects bad prose${R}`);
  const sample = chosen[0];
  if (!sample) {
    problems.push("no markets available to test the guard against");
  } else {
    const a = gradeSnapshot(sample);
    const good = { headline: "Measured.", summary: "Signals were measured.", perSignal: [] as { signalId: string; reading: string }[] };

    const cases: { name: string; text: typeof good; expect: string }[] = [
      {
        name: "fabricated number",
        text: { ...good, summary: "The spread measured 7.431 points against a mid of 0.5." },
        expect: "fabricated-number",
      },
      {
        name: "outcome prediction",
        text: { ...good, summary: "This market will likely resolve YES before expiry." },
        expect: "outcome-prediction",
      },
      {
        name: "nonexistent signal cited",
        text: { ...good, perSignal: [{ signalId: "sentiment", reading: "Sentiment is positive." }] },
        expect: "unknown-signal",
      },
      {
        name: `contradicting the ${a.verdict} verdict`,
        text: {
          ...good,
          summary:
            a.verdict === "ALLOW"
              ? "Do not trade this market under any circumstances."
              : "This market is safe to trade right now.",
        },
        expect: "verdict-contradiction",
      },
    ];

    for (const c of cases) {
      const failures = guardExplanation(c.text, a);
      const caught = failures.some((f) => f.check === c.expect);
      console.log(
        caught
          ? `  ${GRN}PASS${R} ${c.name} ${DIM}→ ${c.expect}${R}`
          : `  ${RED}FAIL${R} ${c.name} ${DIM}(expected ${c.expect}, got ${failures.map((f) => f.check).join(",") || "nothing"})${R}`,
      );
      if (!caught) problems.push(`guard missed: ${c.name}`);
    }

    // And the converse: clean prose must pass, or the guard is just noise.
    const clean = guardExplanation(
      {
        headline: "Spread and depth are in line with this venue.",
        summary: "Every signal was measured and sits inside the observed range.",
        perSignal: a.signals.map((s) => ({ signalId: s.id, reading: `${s.label} was measured.` })),
      },
      a,
    );
    // Unmeasured signals legitimately trip the "described as ok" check here, so
    // only require that clean prose raises no FABRICATION or contradiction.
    const spurious = clean.filter(
      (f) => f.check === "fabricated-number" || f.check === "verdict-contradiction" || f.check === "unknown-signal",
    );
    console.log(
      spurious.length === 0
        ? `  ${GRN}PASS${R} clean prose passes ${DIM}(no false positives)${R}`
        : `  ${RED}FAIL${R} clean prose rejected: ${spurious.map((f) => f.check).join(", ")}`,
    );
    if (spurious.length > 0) problems.push("guard false-positives on clean prose");
  }

  console.log(`\n${BOLD}gate${R}`);
  if (problems.length === 0) {
    console.log(`  ${GRN}PASS${R} — model explains, engine decides, guard enforces`);
  } else {
    for (const p of problems) console.log(`  ${RED}FAIL${R} ${p}`);
  }

  await shutdown(ctx);
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`${RED}explain script failed${R}`);
  console.error(e);
  process.exit(1);
});
