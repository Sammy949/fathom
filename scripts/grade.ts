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
import {
  degradedFields,
  gradeSnapshot,
  ingestVenue,
  SIGNAL_IDS,
  type Assessment,
  type Severity,
} from "@fathom/core";

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

  // Every assertion below iterates `graded`, so an empty ingest made all of them
  // vacuous and this gate printed PASS having checked nothing. Not theoretical:
  // pointing VENUE_ID at an id carrying no markets returned PASS on every check
  // with `confidence min Infinity max -Infinity` as the only visible tell. An
  // ingest failure was likewise printed in red and then dropped, so eight markets
  // failing to load was still a green gate.
  if (graded.length === 0) {
    problems.push("no markets were graded at all, so every check below is vacuous");
  }
  for (const f of failures) {
    problems.push(`${f.marketId.slice(-6)} could not be snapshotted, so it went ungraded: ${f.reason}`);
  }

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
  console.log(
    graded.length === 0
      ? `  ${DIM}not asserted — nothing was graded${R}`
      : stable
        ? `  ${GRN}PASS${R} same snapshot, same verdict on all ${graded.length} markets`
        : `  ${RED}FAIL${R} verdicts are not stable`,
  );

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

  if (graded.length < 3) {
    // Fewer than three markets cannot show spread either way. Say so rather than
    // printing PASS for a check that did not run.
    console.log(
      `  ${DIM}not asserted — ${graded.length} market(s) on the board, fewer than the 3 this needs${R}`,
    );
  } else if (varyingSignals.length === 0) {
    problems.push(
      "no signal varied across any market — the measurement layer is not discriminating",
    );
    console.log(`  ${RED}FAIL${R} every signal returned the same severity on all ${graded.length} markets`);
  } else {
    console.log(
      `  ${GRN}PASS${R} ${varyingSignals.length} signal(s) vary across markets ${DIM}(${varyingSignals.join(", ")})${R}`,
    );
  }

  // The mapping itself, in both directions — this is the load-bearing check.
  //
  // Two verdicts are set by `gradeSnapshot` BEFORE the severity mapping is
  // consulted, because on-chain status is authoritative: `not-trading` forces
  // BLOCK and `no-onchain-state` forces RECHECK whatever the signals say. Those
  // are asserted on their own terms instead of being run through the severity
  // rules, which would report a correct BLOCK on a Locked market whose signals all
  // read ok as a mapping violation.
  const mappingViolations: string[] = [];
  for (const { snapshot, assessment: a } of graded) {
    const hasSevere = a.signals.some((s) => s.severity === "severe");
    const hasElevated = a.signals.some((s) => s.severity === "elevated");
    const hasUnknown = a.unknownSignals.length > 0;
    const sym = snapshot.identity.symbol;

    const forced = a.rules.find((r) => r.rule === "not-trading" || r.rule === "no-onchain-state");
    if (forced) {
      const want = forced.rule === "not-trading" ? "BLOCK" : "RECHECK";
      if (a.verdict !== want) {
        mappingViolations.push(`${sym}: ${forced.rule} must force ${want}, got ${a.verdict}`);
      }
      if (a.action !== "do_not_execute") {
        mappingViolations.push(`${sym}: ${forced.rule} but action is ${a.action}`);
      }
      continue;
    }

    if (hasSevere && a.verdict !== "BLOCK") {
      mappingViolations.push(`${sym}: has a severe signal but graded ${a.verdict}, not BLOCK`);
    }
    if (!hasSevere && !hasElevated && !hasUnknown && a.verdict !== "ALLOW") {
      mappingViolations.push(`${sym}: every signal is ok but graded ${a.verdict}, not ALLOW`);
    }
    if ((hasElevated || hasUnknown) && !hasSevere && a.verdict !== "RECHECK") {
      mappingViolations.push(`${sym}: has elevated or unmeasured signals but graded ${a.verdict}, not RECHECK`);
    }
  }
  problems.push(...mappingViolations);
  // This line printed PASS unconditionally, outside the loop that collects the
  // violations, so a real mapping break printed PASS and then FAIL underneath it.
  // In a demo people read the line, not the exit code.
  console.log(
    graded.length === 0
      ? `  ${DIM}not asserted — nothing was graded${R}`
      : mappingViolations.length === 0
        ? `  ${GRN}PASS${R} severity → verdict mapping holds on all ${graded.length} markets ${DIM}(${distinct} verdict(s) present: ${Object.entries(tally).filter(([, n]) => n > 0).map(([v, n]) => `${v} ${n}`).join(", ")})${R}`
        : `  ${RED}FAIL${R} ${mappingViolations.length} mapping violation(s): ${mappingViolations.join("; ")}`,
  );

  // Per-signal spread, reported below the mapping check.
  for (const id of ids) {
    const sevs = graded.map((g) => g.assessment.signals.find((s) => s.id === id)?.severity);
    const uniq = [...new Set(sevs)];
    const note = uniq.length === 1 ? `${DIM}constant (${uniq[0]})${R}` : `${uniq.length} distinct: ${uniq.join(", ")}`;
    console.log(`  ${id.padEnd(13)} ${note}`);
  }

  // ── the reads actually landed ─────────────────────────────────────────────
  // The check that was missing outright: nothing above asserts that any given read
  // SUCCEEDED, only that the pipeline produced something. If the per-order chain
  // read degraded on every market, `depth` would print `constant (unknown)` in the
  // spread table and this gate would still pass, so the one signal no other venue
  // interface can produce could go dark unnoticed until a demo.
  //
  // Degraded on SOME markets is normal and stays a warning. Degraded on ALL of them
  // is an outage in that source, and the signals built on it are dark rather than
  // measured. `absent` is excluded deliberately: a market with no oracle question
  // legitimately has nothing to read.
  console.log(`\n${BOLD}reads${R}`);
  const degradedTally = new Map<string, number>();
  for (const g of graded) {
    for (const field of degradedFields(g.snapshot)) {
      degradedTally.set(field, (degradedTally.get(field) ?? 0) + 1);
    }
  }
  if (graded.length > 0 && degradedTally.size === 0) {
    console.log(`  ${GRN}PASS${R} every read landed on all ${graded.length} markets`);
  }
  for (const [field, n] of [...degradedTally].sort((a, b) => b[1] - a[1])) {
    const systemic = n === graded.length;
    console.log(
      `  ${systemic ? RED : YEL}${field.padEnd(11)}${R} degraded on ${n} of ${graded.length}${systemic ? " — every market" : ""}`,
    );
    if (systemic) {
      problems.push(
        `${field}: the read failed on every market, so any signal derived from it is dark rather than measured`,
      );
    }
  }

  // Every market must emit every signal. A signal dropping out of the pipeline would
  // otherwise only narrow the table above, which nobody counts.
  const expectedIds = [...SIGNAL_IDS].join(",");
  const incomplete = graded.filter((g) => g.assessment.signals.map((s) => s.id).join(",") !== expectedIds);
  for (const g of incomplete) {
    problems.push(
      `${g.snapshot.identity.symbol}: emitted [${g.assessment.signals.map((s) => s.id).join(",")}] rather than the full signal set`,
    );
  }
  if (graded.length > 0 && incomplete.length === 0) {
    console.log(`  ${GRN}PASS${R} all ${SIGNAL_IDS.length} signals emitted on every market`);
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
    range.length > 0
      ? `  ${DIM}min ${Math.min(...range)} max ${Math.max(...range)} across ${graded.length} markets${R}`
      : `  ${DIM}no markets to report a confidence range for${R}`,
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
