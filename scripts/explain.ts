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
  if (chosen.length === 0) {
    problems.push("no markets were ingested, so nothing below was actually exercised");
  }

  /** Where each explanation came from, so the gate can assert the model ran. */
  const sources: { symbol: string; source: string; reason?: string; model?: string }[] = [];
  /**
   * Kept separate from `problems` on purpose. The verdict-integrity line below was
   * keyed to the GLOBAL problem count, so the moment any unrelated check pushed a
   * problem it reported "the explanation step altered an assessment" about an
   * assessment that had not changed. Same insensitivity as a gate reading "did
   * something respond": a status line has to be keyed to its own check.
   */
  const integrityViolations: string[] = [];

  for (const snapshot of chosen) {
    const before = gradeSnapshot(snapshot);
    const fpBefore = fingerprint(before);

    const explanation = await explainAssessment(snapshot, before, { offline });

    // Re-grade AFTER the model ran. If the explanation step could reach the
    // engine at all, this is where it would show.
    const after = gradeSnapshot(snapshot);
    if (fingerprint(after) !== fpBefore) {
      integrityViolations.push(snapshot.identity.symbol);
      problems.push(`${snapshot.identity.symbol}: assessment changed across the explanation step`);
    }

    const trace = buildTrace(snapshot, after, explanation);
    const vc = VERDICT_COLOR[trace.verdict];

    sources.push({
      symbol: trace.symbol,
      source: trace.explanation.source,
      reason: trace.explanation.fallbackReason,
      model: trace.explanation.model,
    });

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

  // ── the model actually ran ──────────────────────────────────────────────────
  // This gate reported PASS while 0 of 3 markets were model-explained, because
  // nothing here looked at `explanation.source` — the deterministic fallback is
  // designed to absorb exactly that failure, so "something responded" is all the
  // gate ever checked. That is how the `signal_id` enum drift stayed green: the
  // only visible trace was the fallback-reason line, and a human had to read it.
  //
  // So when a provider is configured and we are not deliberately offline, every
  // chosen market must come back model-explained, and a fallback names its own
  // reason in the failure. A rate limit failing this gate is correct: the whole
  // point of the token budget and the 429 retry is that the model path holds
  // inside the free tier, and a run that quietly degrades is the thing being
  // guarded against.
  console.log(`\n${BOLD}explanation source${R}`);
  const modelExplained = sources.filter((s) => s.source === "model");
  if (offline || !provider) {
    console.log(
      `  ${DIM}not asserted — ${offline ? "offline mode requested" : "no provider configured"}, the fallback narrator is the expected path${R}`,
    );
  } else if (chosen.length > 0 && modelExplained.length === chosen.length) {
    console.log(
      `  ${GRN}PASS${R} ${modelExplained.length} of ${chosen.length} explained by ${modelExplained[0]?.model ?? "the model"}`,
    );
  } else {
    console.log(
      `  ${RED}FAIL${R} ${modelExplained.length} of ${chosen.length} model-explained${R}`,
    );
    for (const s of sources.filter((s) => s.source !== "model")) {
      console.log(`    ${DIM}${s.symbol}: ${s.reason ?? "no reason recorded"}${R}`);
      problems.push(`${s.symbol} fell back to the narrator: ${s.reason ?? "no reason recorded"}`);
    }
  }

  // ── the structural guarantee ───────────────────────────────────────────────
  console.log(`\n${BOLD}verdict integrity${R}`);
  console.log(
    chosen.length === 0
      ? `  ${DIM}not asserted — no markets to explain${R}`
      : integrityViolations.length === 0
        ? `  ${GRN}PASS${R} verdict, confidence, action and every severity unchanged across explanation on all ${chosen.length} markets`
        : `  ${RED}FAIL${R} the explanation step altered an assessment on ${integrityViolations.join(", ")}`,
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
        // The real failure, taken verbatim off a rendered page. Every figure in it
        // was honest and copied correctly, which is why no other guard fired: the
        // defect is register, not accuracy. A log line is not an explanation.
        name: "field names and hex quoted in prose",
        text: {
          ...good,
          summary:
            "Listed on DreamDEX (venueId=0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c) with recent activity (lastTradeAgeSec=103).",
        },
        expect: "machine-syntax",
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
      (f) =>
        f.check === "fabricated-number" ||
        f.check === "verdict-contradiction" ||
        f.check === "unknown-signal" ||
        f.check === "machine-syntax",
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
    // The claim has to match the path that actually ran. Saying "model explains"
    // after a narrator-only run is the same insensitivity this gate was just fixed
    // for, one line further down.
    console.log(
      offline || !provider
        ? `  ${GRN}PASS${R} — engine decides, guard enforces ${DIM}(narrator path: the model was not exercised)${R}`
        : `  ${GRN}PASS${R} — model explains, engine decides, guard enforces`,
    );
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
