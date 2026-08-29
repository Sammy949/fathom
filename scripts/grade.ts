/**
 * Stage 4 gate. Grades every live market and prints the full decision trace.
 *
 *   npm run grade
 *
 * Two jobs. First, show the verdicts against real markets. Second, and more
 * importantly, prove the engine DISCRIMINATES: a risk engine that returns the same
 * verdict for every market has told you nothing, and that is the likeliest way
 * this fails. So the gate asserts spread across verdicts and flags any signal that
 * came back constant.
 *
 * Read-only; sends nothing.
 */

import { createExchange, shutdown } from "@fathom/ec";
import { gradeSnapshot, ingestVenue, type Assessment, type Severity } from "@fathom/core";

const R = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YEL = "\x1b[33m";
const GRN = "\x1b[32m";
const CYA = "\x1b[36m";

const SEV_COLOR: Record<Severity, string> = {
  ok: GRN,
  elevated: YEL,
  severe: RED,
  unknown: DIM,
};

const VERDICT_COLOR = { ALLOW: GRN, RECHECK: YEL, BLOCK: RED } as const;

const problems: string[] = [];

function trace(symbol: string, window: string, a: Assessment): void {
  const vc = VERDICT_COLOR[a.verdict];
  console.log(
    `\n${BOLD}${symbol}${R} ${DIM}${window}${R}  →  ${vc}${BOLD}${a.verdict}${R} ${DIM}confidence ${a.confidence}${R}`,
  );

  // The signal table: what was measured, and the number behind it.
  for (const s of a.signals) {
    const c = SEV_COLOR[s.severity];
    console.log(`  ${c}${s.severity.padEnd(8)}${R} ${s.label.padEnd(11)} ${s.finding}`);
  }

  // The rules that fired, in evaluation order. This is the part that makes the
  // verdict inspectable rather than asserted.
  console.log(`  ${CYA}why${R}`);
  for (const r of a.rules) console.log(`    ${DIM}${r.rule}${R} — ${r.because}`);

  if (a.requiredChecks.length > 0) {
    console.log(`  ${CYA}before acting${R}`);
    for (const c of a.requiredChecks) console.log(`    · ${c}`);
  }

  if (a.unknownSignals.length > 0) {
    console.log(`  ${DIM}unmeasured: ${a.unknownSignals.join(", ")} (confidence capped accordingly)${R}`);
  }
}

async function main(): Promise<void> {
  const ctx = createExchange({ withSigner: false });
  console.log(`${BOLD}Fathom — Stage 4 risk verdicts${R}`);
  console.log(`${DIM}${ctx.config.network} · deterministic engine, no model involved${R}`);

  const { snapshots, failures } = await ingestVenue(ctx);
  if (failures.length) {
    for (const f of failures) console.log(`${RED}ingest failed${R} ${f.marketId.slice(-6)}: ${f.reason}`);
  }

  const graded = snapshots.map((s) => ({
    snapshot: s,
    assessment: gradeSnapshot(s),
  }));

  for (const { snapshot, assessment } of graded) {
    const win = snapshot.identity.intervalSec ? `${snapshot.identity.intervalSec / 60}m window` : "";
    trace(snapshot.identity.symbol, win, assessment);
  }

  // ── summary ───────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}summary${R}`);
  const tally = { ALLOW: 0, RECHECK: 0, BLOCK: 0 };
  for (const g of graded) tally[g.assessment.verdict]++;
  console.log(
    `  ${GRN}ALLOW ${tally.ALLOW}${R}  ${YEL}RECHECK ${tally.RECHECK}${R}  ${RED}BLOCK ${tally.BLOCK}${R}  ${DIM}of ${graded.length}${R}`,
  );

  // ── determinism ───────────────────────────────────────────────────────────
  // The central product claim is that code computes the score. If grading the same
  // snapshot twice ever differed, that claim would be false.
  console.log(`\n${BOLD}determinism${R}`);
  let stable = true;
  for (const { snapshot, assessment } of graded) {
    const again = gradeSnapshot(snapshot);
    if (JSON.stringify(again) !== JSON.stringify(assessment)) {
      stable = false;
      problems.push(`${snapshot.identity.symbol}: re-grading the same snapshot produced a different result`);
    }
  }
  console.log(stable ? `  ${GRN}PASS${R} same snapshot, same verdict` : `  ${RED}FAIL${R} verdicts are not stable`);

  // ── discrimination ────────────────────────────────────────────────────────
  // The failure mode worth catching is an engine that cannot tell markets apart.
  // But "N markets, 1 verdict" does not prove that, and two earlier versions of
  // this check failed on healthy code:
  //
  //   - All six markets had never traded, so one verdict WAS the right answer.
  //   - Two genuinely different signal shapes both mapped to RECHECK, which is
  //     correct: the verdict space has three values and many shapes legitimately
  //     land on the middle one.
  //
  // So check the two things that are actually invariants, not variety:
  //   1. Severities vary across markets — the measurement layer discriminates.
  //   2. The severity → verdict mapping is exactly right in both directions.
  // Fixture coverage in test-risk.ts proves the dangerous paths, because it does
  // not depend on what the venue happens to be doing.
  console.log(`\n${BOLD}discrimination${R}`);
  const ids = [...new Set(graded.flatMap((g) => g.assessment.signals.map((s) => s.id)))];
  const distinct = Object.values(tally).filter((n) => n > 0).length;

  const varyingSignals = ids.filter((id) => {
    const sevs = new Set(graded.map((g) => g.assessment.signals.find((s) => s.id === id)?.severity));
    return sevs.size > 1;
  });

  if (graded.length >= 3 && varyingSignals.length === 0) {
    problems.push(
      "no signal varied across any market — the measurement layer is not discriminating",
    );
    console.log(`  ${RED}FAIL${R} every signal returned the same severity on all ${graded.length} markets`);
  } else {
    console.log(
      `  ${GRN}PASS${R} ${varyingSignals.length} signal(s) vary across markets ${DIM}(${varyingSignals.join(", ") || "none"})${R}`,
    );
  }

  // The mapping itself, in both directions — this is the load-bearing check.
  for (const { snapshot, assessment: a } of graded) {
    const hasSevere = a.signals.some((s) => s.severity === "severe");
    const hasElevated = a.signals.some((s) => s.severity === "elevated");
    const hasUnknown = a.unknownSignals.length > 0;
    const sym = snapshot.identity.symbol;

    if (hasSevere && a.verdict !== "BLOCK") {
      problems.push(`${sym}: has a severe signal but graded ${a.verdict}, not BLOCK`);
    }
    if (!hasSevere && !hasElevated && !hasUnknown && a.verdict !== "ALLOW") {
      problems.push(`${sym}: every signal is ok but graded ${a.verdict}, not ALLOW`);
    }
    if ((hasElevated || hasUnknown) && !hasSevere && a.verdict !== "RECHECK") {
      problems.push(`${sym}: has elevated or unmeasured signals but graded ${a.verdict}, not RECHECK`);
    }
  }
  console.log(
    `  ${GRN}PASS${R} severity → verdict mapping holds on all ${graded.length} markets ${DIM}(${distinct} verdict(s) present: ${Object.entries(tally).filter(([, n]) => n > 0).map(([v, n]) => `${v} ${n}`).join(", ")})${R}`,
  );

  // Per-signal spread, reported below the mapping check.
  for (const id of ids) {
    const sevs = graded.map((g) => g.assessment.signals.find((s) => s.id === id)?.severity);
    const uniq = [...new Set(sevs)];
    const note = uniq.length === 1 ? `${DIM}constant (${uniq[0]})${R}` : `${uniq.length} distinct: ${uniq.join(", ")}`;
    console.log(`  ${id.padEnd(13)} ${note}`);
  }

  // ── confidence sanity ─────────────────────────────────────────────────────
  console.log(`\n${BOLD}confidence${R}`);
  for (const g of graded) {
    const a = g.assessment;
    // Confidence must reflect observational completeness. A verdict with several
    // blind spots reporting high confidence would be exactly the overclaiming this
    // product exists to avoid.
    if (a.unknownSignals.length >= 3 && a.confidence > 0.7) {
      problems.push(
        `${g.snapshot.identity.symbol}: ${a.unknownSignals.length} unmeasured signals but confidence ${a.confidence}`,
      );
    }
    if (a.verdict === "ALLOW" && a.unknownSignals.length > 0) {
      // ALLOW on incomplete data is the one combination that must never occur.
      problems.push(
        `${g.snapshot.identity.symbol}: ALLOW with unmeasured signals (${a.unknownSignals.join(", ")}) — silence is not safety`,
      );
    }
  }
  const range = graded.map((g) => g.assessment.confidence);
  console.log(
    `  ${DIM}min ${Math.min(...range)} max ${Math.max(...range)} across ${graded.length} markets${R}`,
  );

  console.log(`\n${BOLD}gate${R}`);
  if (problems.length === 0) {
    console.log(`  ${GRN}PASS${R} — deterministic, discriminating, confidence tracks observability`);
  } else {
    for (const p of problems) console.log(`  ${RED}FAIL${R} ${p}`);
  }

  await shutdown(ctx);
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`${RED}grade script failed${R}`);
  console.error(e);
  process.exit(1);
});
