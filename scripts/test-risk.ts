/**
 * Verdict state-machine tests over synthetic snapshots.
 *
 *   npm run test:risk
 *
 * WHY FIXTURES AND NOT JUST LIVE MARKETS: `npm run grade` only exercises the paths
 * the venue happens to be showing. Two consecutive runs produced
 * "ALLOW 5 / RECHECK 3 / BLOCK 2" and then "ALLOW 6 / RECHECK 4 / BLOCK 0" —
 * identical code, different market conditions, because the BLOCK cases were two
 * markets that happened to be Locked at that moment. A gate that can only test
 * what the venue is currently doing cannot prove the dangerous paths work.
 *
 * So the severe cases — crossed books, superseded oracles, voided markets, lapsed
 * settlement, wrong venue — are constructed here and asserted directly. Several of
 * them we may never see live before the deadline, and those are exactly the ones a
 * judge might ask about.
 *
 * No network. Pure functions in, verdicts out.
 */

import {
  assess,
  gradeSnapshot,
  liquiditySignal,
  manipulationSignal,
  resolutionSignal,
  stalenessSignal,
  venueSignal,
  volatilitySignal,
  windowSignal,
  DREAMDEX_VENUE_ID,
  ok,
  degraded,
  type BookMetrics,
  type FlowMetrics,
  type Freshness,
  type MarketSnapshot,
  type MoveMetrics,
  type OnchainState,
  type ResolutionState,
  type Verdict,
} from "@fathom/core";

const R = "\x1b[0m";
const GRN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

let passed = 0;
const failures: string[] = [];

function expect(name: string, actual: unknown, wanted: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(wanted)) {
    passed++;
    console.log(`  ${GRN}✓${R} ${name}`);
  } else {
    failures.push(`${name}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
    console.log(`  ${RED}✗${R} ${name} ${DIM}expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}${R}`);
  }
}

// ── builders ───────────────────────────────────────────────────────────────────

/** A book in line with the venue's measured normal: ~2.6 point spread, 990 a side. */
function healthyBook(overrides: Partial<BookMetrics> = {}): BookMetrics {
  return {
    symbol: "BTC-0-29AUG26/tUSDC#YES",
    bid: { best: 0.25, levels: 3, depthShares: 990, nearShares: 990, nearNotional: 247 },
    ask: { best: 0.276, levels: 3, depthShares: 990, nearShares: 990, nearNotional: 273 },
    mid: 0.263,
    spread: 0.026,
    spreadPct: 0.026 / 0.263,
    imbalance: 0,
    crossed: false,
    assembledAt: Date.now(),
    nearBand: 0.05,
    ...overrides,
  };
}

const healthyMove = (o: Partial<MoveMetrics> = {}): MoveMetrics => ({
  maxStep: 0.1,
  netChange: -0.05,
  volume: 500,
  samples: 6,
  spanSec: 36_000,
  insufficient: false,
  ...o,
});

const healthyFlow = (o: Partial<FlowMetrics> = {}): FlowMetrics => ({
  count: 18,
  takerBuyShares: 390,
  takerSellShares: 200,
  skew: 0.32,
  mintedShares: 100,
  ageSec: 240,
  vwap: 0.242,
  ...o,
});

const healthyFresh = (o: Partial<Freshness> = {}): Freshness => ({
  lastTradeAgeSec: 240,
  ageVsWindow: 240 / 86_400,
  windowElapsed: 0.56,
  secToExpiry: 37_800,
  neverTraded: false,
  ...o,
});

const healthyResolution = (o: Partial<ResolutionState> = {}): ResolutionState => ({
  oracleQuestionId: "45835",
  supersededByQuestionId: null,
  oracleVoided: null,
  oracleResolvedAtSec: null,
  reuseCount: 0,
  oracleExplorerUrl: "https://prd.oracle.somnia.host/questions/45835?view=graph",
  pastExpirySec: null,
  // The real venue's series all carry 300s. Measured on market 0x…c067.
  settlementWindowSec: 300,
  lapsedSec: null,
  ...o,
});

const tradingOnchain = (o: Partial<OnchainState> = {}): OnchainState => ({
  status: 1,
  statusName: "Trading",
  tradable: true,
  isResolved: false,
  isVoided: false,
  winningOutcome: 0,
  finalized: false,
  expirySec: Math.floor(Date.now() / 1000) + 37_800,
  backing: "1000000000",
  settlementWindowSec: 300,
  ...o,
});

/** A fully healthy snapshot on the real venue — the ALLOW baseline. */
function snapshot(o: {
  onchain?: OnchainState | null;
  book?: BookMetrics | null;
  move?: MoveMetrics | null;
  flow?: FlowMetrics | null;
  fresh?: Freshness | null;
  resolution?: ResolutionState | null;
  venueId?: string | null;
} = {}): MarketSnapshot {
  const nullable = <T>(v: T | null | undefined, fallback: T) =>
    v === null ? degraded<T>("test: unavailable") : ok(v === undefined ? fallback : v);

  return {
    identity: {
      marketId: "0x…b74b",
      venueId: o.venueId === undefined ? DREAMDEX_VENUE_ID : o.venueId,
      operatorId: 2,
      asset: "BTC",
      intervalSec: 86_400,
      symbol: "BTC-0-29AUG26/tUSDC",
      yesSymbol: "BTC-0-29AUG26/tUSDC#YES",
      noSymbol: "BTC-0-29AUG26/tUSDC#NO",
      poolAddress: "0xpool",
      nonce: "1",
      collateral: "0xtusdc",
      collateralDecimals: 6,
      tradingStartSec: Math.floor(Date.now() / 1000) - 48_600,
      expirySec: Math.floor(Date.now() / 1000) + 37_800,
      strike: "0",
      question: "BTC closes at or above its opening price",
    },
    assembledAt: Date.now(),
    onchain: nullable(o.onchain, tradingOnchain()),
    book: nullable(o.book, healthyBook()),
    prices: ok([]),
    move: nullable(o.move, healthyMove()),
    flow: nullable(o.flow, healthyFlow()),
    freshness: nullable(o.fresh, healthyFresh()),
    resolution: nullable(o.resolution, healthyResolution()),
    row: {} as MarketSnapshot["row"],
  };
}

const verdictOf = (s: MarketSnapshot): Verdict => gradeSnapshot(s).verdict;

// ── the baseline ───────────────────────────────────────────────────────────────

console.log(`${BOLD}Fathom — verdict state machine${R}\n`);
console.log(`${BOLD}baseline${R}`);
expect("fully healthy market → ALLOW", verdictOf(snapshot()), "ALLOW");
expect("healthy market may execute", gradeSnapshot(snapshot()).action, "may_execute");
expect("healthy market needs no checks", gradeSnapshot(snapshot()).requiredChecks.length, 0);

// ── BLOCK: paths we may never see live before the deadline ─────────────────────

console.log(`\n${BOLD}BLOCK paths${R}`);

expect(
  "wrong venue → BLOCK",
  verdictOf(snapshot({ venueId: "0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f" })),
  "BLOCK",
);

expect(
  "superseded oracle question → BLOCK",
  verdictOf(snapshot({ resolution: healthyResolution({ supersededByQuestionId: "46000" }) })),
  "BLOCK",
);

expect(
  "oracle voided → BLOCK",
  verdictOf(snapshot({ resolution: healthyResolution({ oracleVoided: true }) })),
  "BLOCK",
);

expect(
  "no oracle bound → BLOCK",
  verdictOf(snapshot({ resolution: healthyResolution({ oracleQuestionId: null }) })),
  "BLOCK",
);

// THREE STATES, not one escalating number. Measuring the lapse from `expiry`
// conflated "the oracle is a minute late" with "anyone can void this now", which
// are different verdicts — the first is normal and the second is terminal.
expect(
  "past expiry, inside the settlement window → RECHECK, not BLOCK",
  verdictOf(snapshot({ resolution: healthyResolution({ pastExpirySec: 120 }) })),
  "RECHECK",
);

expect(
  "past expiry, inside the window → elevated",
  resolutionSignal(healthyResolution({ pastExpirySec: 120 })).severity,
  "elevated",
);

expect(
  "settlement window lapsed at all → BLOCK",
  verdictOf(snapshot({ resolution: healthyResolution({ pastExpirySec: 400, lapsedSec: 100 }) })),
  "BLOCK",
);

// The stuck market on our own venue: 4d 9h past voidable. The finding has to
// render that as days — "6328 min ago" was the old output and no reader parses it.
expect(
  "four-day lapse renders in days, not minutes",
  /\b4d 9h ago\b/.test(resolutionSignal(healthyResolution({ pastExpirySec: 379_787, lapsedSec: 379_487 })).finding),
  true,
);

expect(
  "unreadable settlement window cannot assert voidable",
  resolutionSignal(healthyResolution({ pastExpirySec: 400, settlementWindowSec: null })).severity,
  "elevated",
);

expect(
  "empty book → BLOCK",
  verdictOf(
    snapshot({
      book: healthyBook({
        bid: { levels: 0, depthShares: 0, nearShares: 0, nearNotional: 0 },
        ask: { levels: 0, depthShares: 0, nearShares: 0, nearNotional: 0 },
        mid: undefined,
        spread: undefined,
        spreadPct: undefined,
        imbalance: undefined,
        unusable: "empty",
      }),
    }),
  ),
  "BLOCK",
);

expect(
  "one-sided book → BLOCK",
  verdictOf(
    snapshot({
      book: healthyBook({
        ask: { levels: 0, depthShares: 0, nearShares: 0, nearNotional: 0 },
        mid: undefined,
        spread: undefined,
        unusable: "one-sided",
      }),
    }),
  ),
  "BLOCK",
);

expect(
  "spread wider than mid → BLOCK",
  verdictOf(
    snapshot({
      book: healthyBook({
        bid: { best: 0.009, levels: 1, depthShares: 300, nearShares: 300, nearNotional: 3 },
        ask: { best: 0.03, levels: 1, depthShares: 300, nearShares: 300, nearNotional: 9 },
        mid: 0.019,
        spread: 0.021,
        spreadPct: 0.021 / 0.019,
      }),
    }),
  ),
  "BLOCK",
);

// 99% elapsed is not "advanced", it is effectively over — the market can lock
// between the snapshot and the send, which is the whole reason this signal exists.
expect(
  "window 99% elapsed → BLOCK",
  verdictOf(snapshot({ fresh: healthyFresh({ secToExpiry: 280, windowElapsed: 0.99 }) })),
  "BLOCK",
);

expect(
  "locked market → BLOCK",
  verdictOf(snapshot({ onchain: tradingOnchain({ status: 2, statusName: "Locked", tradable: false }) })),
  "BLOCK",
);

expect(
  "resolved market → BLOCK",
  verdictOf(
    snapshot({
      onchain: tradingOnchain({
        status: 4,
        statusName: "Resolved",
        tradable: false,
        isResolved: true,
        winningOutcome: 1,
      }),
    }),
  ),
  "BLOCK",
);

// A resolved market's advice must be about redeeming, not about position sizing.
const resolvedChecks = gradeSnapshot(
  snapshot({
    onchain: tradingOnchain({ status: 4, statusName: "Resolved", tradable: false, isResolved: true }),
  }),
).requiredChecks;
expect("resolved market advises redeeming", resolvedChecks, [
  "Redeem any winning position rather than attempting to trade",
]);

expect(
  "voided market advises both legs",
  gradeSnapshot(
    snapshot({
      onchain: tradingOnchain({ status: 5, statusName: "Voided", tradable: false, isVoided: true }),
    }),
  ).requiredChecks,
  ["Redeem both outcome legs at 0.5 each"],
);

// ── RECHECK: the honest-uncertainty paths ─────────────────────────────────────

console.log(`\n${BOLD}RECHECK paths${R}`);

expect(
  "unmeasured volatility blocks ALLOW",
  verdictOf(snapshot({ move: healthyMove({ insufficient: true, samples: 1, maxStep: undefined }) })),
  "RECHECK",
);

expect(
  "unmeasured flow blocks ALLOW",
  verdictOf(snapshot({ flow: healthyFlow({ count: 0, skew: undefined }) })),
  "RECHECK",
);

expect(
  "degraded book → RECHECK not BLOCK",
  verdictOf(snapshot({ book: null })),
  "RECHECK",
);

expect(
  "missing on-chain state → RECHECK",
  verdictOf(snapshot({ onchain: null })),
  "RECHECK",
);

expect(
  "stale beyond 35% of window → RECHECK",
  verdictOf(snapshot({ fresh: healthyFresh({ lastTradeAgeSec: 40_000, ageVsWindow: 0.46 }) })),
  "RECHECK",
);

// Elevated: the window is well advanced but there is still room to act.
expect(
  "window 85% elapsed → RECHECK",
  verdictOf(snapshot({ fresh: healthyFresh({ secToExpiry: 2_100, windowElapsed: 0.85 }) })),
  "RECHECK",
);

expect(
  "one-sided flow → RECHECK",
  verdictOf(snapshot({ flow: healthyFlow({ skew: -0.95, takerBuyShares: 10, takerSellShares: 390 }) })),
  "RECHECK",
);

expect(
  "one-sided flow AND skewed depth → BLOCK",
  verdictOf(
    snapshot({
      flow: healthyFlow({ skew: -0.95, takerBuyShares: 10, takerSellShares: 390 }),
      book: healthyBook({
        bid: { best: 0.25, levels: 3, depthShares: 200, nearShares: 200, nearNotional: 50 },
        ask: { best: 0.276, levels: 3, depthShares: 990, nearShares: 990, nearNotional: 273 },
        imbalance: -0.66,
      }),
    }),
  ),
  "BLOCK",
);

expect(
  "wide-but-tradable spread → RECHECK",
  verdictOf(
    snapshot({
      book: healthyBook({
        bid: { best: 0.22, levels: 2, depthShares: 500, nearShares: 500, nearNotional: 110 },
        ask: { best: 0.26, levels: 2, depthShares: 500, nearShares: 500, nearNotional: 130 },
        mid: 0.24,
        spread: 0.04,
        spreadPct: 0.04 / 0.24,
      }),
    }),
  ),
  "RECHECK",
);

// ── invariants ────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}invariants${R}`);

// The one combination that must never occur: cleared for execution with a blind spot.
const cases: MarketSnapshot[] = [
  snapshot(),
  snapshot({ move: null }),
  snapshot({ flow: null }),
  snapshot({ book: null }),
  snapshot({ onchain: null }),
  snapshot({ resolution: null }),
  snapshot({ fresh: null }),
  snapshot({ move: healthyMove({ insufficient: true, samples: 0 }) }),
];
const badAllow = cases.filter((s) => {
  const a = gradeSnapshot(s);
  return a.verdict === "ALLOW" && a.unknownSignals.length > 0;
});
expect("ALLOW never co-occurs with an unmeasured signal", badAllow.length, 0);

// Only ALLOW may permit execution.
const badAction = cases.filter((s) => {
  const a = gradeSnapshot(s);
  return a.action === "may_execute" && a.verdict !== "ALLOW";
});
expect("only ALLOW permits execution", badAction.length, 0);

// A crossed book is a broken READ, not a risky market — it must not be scored as
// severe, because that would be treating our own data bug as market evidence.
const crossed = liquiditySignal(
  healthyBook({
    bid: { best: 0.32, levels: 3, depthShares: 900, nearShares: 900, nearNotional: 288 },
    ask: { best: 0.27, levels: 3, depthShares: 900, nearShares: 900, nearNotional: 243 },
    mid: 0.295,
    spread: -0.05,
    crossed: true,
    unusable: "crossed",
  }),
);
expect("crossed book reads as unknown, not severe", crossed.severity, "unknown");

// Confidence must never exceed observational completeness.
const halfBlind = gradeSnapshot(snapshot({ move: null, flow: null, resolution: null }));
expect("confidence drops with blind spots", halfBlind.confidence <= 0.75, true);

// Every signal must carry its calibration basis — an unexplained threshold is
// indistinguishable from an arbitrary one.
const allSignals = gradeSnapshot(snapshot()).signals;
expect("every signal states its basis", allSignals.every((s) => s.basis.length > 20), true);
expect("every signal states a finding", allSignals.every((s) => s.finding.length > 10), true);

// Determinism, explicitly.
const s1 = snapshot();
expect(
  "same snapshot grades identically",
  JSON.stringify(gradeSnapshot(s1)) === JSON.stringify(gradeSnapshot(s1)),
  true,
);

// An empty signal set must not silently pass as healthy.
expect("no signals → not ALLOW-with-confidence", assess([]).confidence <= 0.5, true);

// ── individual signal boundaries ──────────────────────────────────────────────

console.log(`\n${BOLD}signal boundaries${R}`);

expect(
  "venue: correct venue is ok",
  venueSignal(DREAMDEX_VENUE_ID, null).severity,
  "ok",
);
expect("venue: null venue is unknown", venueSignal(null, null).severity, "unknown");
expect(
  "volatility: 13pt step is normal here",
  volatilitySignal(healthyMove({ maxStep: 0.13 })).severity,
  "ok",
);
expect(
  "volatility: 26pt step is severe",
  volatilitySignal(healthyMove({ maxStep: 0.26 })).severity,
  "severe",
);
expect(
  "staleness: 3% of window is ok",
  stalenessSignal(healthyFresh({ ageVsWindow: 0.03 }), 86_400).severity,
  "ok",
);
expect(
  "staleness: never-traded is elevated not ok",
  stalenessSignal(healthyFresh({ neverTraded: true, lastTradeAgeSec: undefined }), 86_400).severity,
  "elevated",
);
expect(
  "window: closed window is severe",
  windowSignal(healthyFresh({ secToExpiry: -10 }), 86_400).severity,
  "severe",
);
// The bug: `windowElapsedElevated` was declared at 0.8 and never read, so only
// the SEVERE elapsed check was wired in. A live run graded "35 min left, 85% of
// the window elapsed" as ok. Both the absolute and the fractional path now fire.
expect(
  "85% of window elapsed → elevated, not ok",
  windowSignal(healthyFresh({ secToExpiry: 2100, windowElapsed: 0.85 }), 14_400).severity,
  "elevated",
);

expect(
  "95% of window elapsed → severe",
  windowSignal(healthyFresh({ secToExpiry: 700, windowElapsed: 0.95 }), 14_400).severity,
  "severe",
);

expect(
  "60% elapsed with hours left stays ok",
  windowSignal(healthyFresh({ secToExpiry: 5_600, windowElapsed: 0.6 }), 14_400).severity,
  "ok",
);

expect(
  "flow: 2 fills is too few to judge",
  manipulationSignal(healthyFlow({ count: 2, skew: 1 }), healthyBook()).severity,
  "unknown",
);
expect(
  "flow: balanced over 18 fills is ok",
  manipulationSignal(healthyFlow(), healthyBook()).severity,
  "ok",
);
expect(
  "resolution: healthy binding is ok",
  resolutionSignal(healthyResolution()).severity,
  "ok",
);

// ── result ────────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}result${R}`);
if (failures.length === 0) {
  console.log(`  ${GRN}PASS${R} ${passed} assertions`);
  process.exit(0);
}
for (const f of failures) console.log(`  ${RED}FAIL${R} ${f}`);
console.log(`  ${RED}${failures.length} failed${R}, ${passed} passed`);
process.exit(1);
