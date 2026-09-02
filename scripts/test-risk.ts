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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assess,
  bucketOf,
  depthSignal,
  freshness,
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
  type DepthMetrics,
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
  recencyUnknown: false,
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

/**
 * The per-order depth this venue actually shows, measured on all 10 live markets
 * twice: one owner holding 100% of both sides, 6 orders, 1,980 shares, TTL
 * 11-28s, nothing past expiry. Every owner is a beacon proxy, so all of it is
 * pullable and the firm bucket is 0 -- see depth.ts for why that is not a bug.
 */
const venueDepth = (o: Partial<DepthMetrics> = {}): DepthMetrics => ({
  orders: 6,
  bidShares: 990,
  askShares: 990,
  totalShares: 1980,
  owners: 1,
  topOwnerShare: 1,
  concentration: 1,
  medianTtlSec: 18,
  minTtlSec: 11,
  maxTtlSec: 28,
  firmShares: 0,
  pullableShares: 1980,
  unverifiedShares: 0,
  phantomShares: 0,
  byOwner: [
    {
      owner: "0x3a29C57069eF535B842660f4437E26881c9358A8",
      class: "upgradeable",
      reason: "proxy delegating to 0x8635C413B666eA8fcCf3BB302f7a7cE3988892a4 -- the code deciding whether it can cancel is replaceable by whoever controls the target",
      shares: 1980,
      share: 1,
      soonestTtlSec: 11,
    },
  ],
  readAt: Date.now(),
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
  depth?: DepthMetrics | null;
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
    depth: nullable(o.depth, venueDepth()),
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

/** An order book with nothing on either side. */
const emptySide = { levels: 0, depthShares: 0, nearShares: 0, nearNotional: 0 };
const emptyBook = (o: Partial<BookMetrics> = {}): BookMetrics =>
  healthyBook({
    bid: emptySide,
    ask: emptySide,
    mid: undefined,
    spread: undefined,
    spreadPct: undefined,
    imbalance: undefined,
    unusable: "empty",
    ...o,
  });

/** The per-order chain read agreeing that nothing is resting. */
const noResting = (o: Partial<DepthMetrics> = {}): DepthMetrics =>
  venueDepth({
    orders: 0,
    bidShares: 0,
    askShares: 0,
    totalShares: 0,
    pullableShares: 0,
    byOwner: [],
    medianTtlSec: null,
    minTtlSec: null,
    maxTtlSec: null,
    ...o,
  });

expect(
  "empty book → BLOCK",
  verdictOf(
    snapshot({
      book: emptyBook(),
      // Coherent with the book: no orders in the aggregate means none on the chain
      // either. The pair used to disagree — an empty book beside a full 6-order
      // ladder — which is not a state the venue can be in, and is now read as the
      // stale-read signal it always was.
      depth: noResting(),
    }),
  ),
  "BLOCK",
);

expect(
  "one-sided book → BLOCK",
  verdictOf(
    snapshot({
      book: healthyBook({
        ask: emptySide,
        mid: undefined,
        spread: undefined,
        unusable: "one-sided",
      }),
      depth: venueDepth({ orders: 3, bidShares: 990, askShares: 0, totalShares: 990, pullableShares: 990 }),
    }),
  ),
  "BLOCK",
);

// ── the two sources disagreeing ───────────────────────────────────────────────
// An empty aggregated book beside a live per-order chain read is not a market with
// no liquidity, it is one read contradicting another. Grading BLOCK off the loser of
// that contradiction is how a healthy market gets a false BLOCK in front of a judge.
expect(
  "empty book contradicted by a live chain read is unknown, not severe",
  liquiditySignal(emptyBook(), venueDepth()).severity,
  "unknown",
);
expect(
  "that contradiction is RECHECK, not BLOCK",
  verdictOf(snapshot({ book: emptyBook(), depth: venueDepth() })),
  "RECHECK",
);
expect(
  "and it asks for the book to be re-read",
  gradeSnapshot(snapshot({ book: emptyBook(), depth: venueDepth() })).rules.map((r) => r.rule),
  ["unobservable-liquidity"],
);
expect(
  "one-sided book contradicted by both sides on chain is unknown",
  liquiditySignal(healthyBook({ ask: emptySide, mid: undefined, spread: undefined, unusable: "one-sided" }), venueDepth())
    .severity,
  "unknown",
);
// The three ways the downgrade must NOT fire. Each one is a case where the chain
// read agrees, cannot corroborate, or corroborates nothing fillable.
expect(
  "an empty book the chain agrees with stays severe",
  liquiditySignal(emptyBook(), noResting()).severity,
  "severe",
);
expect(
  "an unreadable chain read never downgrades the book",
  liquiditySignal(emptyBook(), null).severity,
  "severe",
);
expect(
  "a chain read that is entirely past expiry never downgrades the book",
  liquiditySignal(emptyBook(), venueDepth({ phantomShares: 1980, pullableShares: 0 })).severity,
  "severe",
);
expect(
  "one side quoted on chain is not a contradiction of a one-sided book",
  liquiditySignal(
    healthyBook({ ask: emptySide, mid: undefined, spread: undefined, unusable: "one-sided" }),
    venueDepth({ orders: 3, bidShares: 990, askShares: 0, totalShares: 990 }),
  ).severity,
  "severe",
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
// A failed fills read and a genuinely quiet market are NOT the same state, and they
// used to produce the identical `neverTraded: true`. Ingestion then wrapped it in
// `ok()`, so the trace asserted "this market has never traded" off the back of an
// outage, with provenance clean enough that `degradedFields` did not list it.
expect(
  "staleness: unestablished recency is unknown, not never-traded",
  stalenessSignal(
    healthyFresh({ recencyUnknown: true, neverTraded: false, lastTradeAgeSec: undefined, ageVsWindow: undefined }),
    86_400,
  ).severity,
  "unknown",
);
expect(
  "staleness: unestablished recency withholds ALLOW",
  verdictOf(
    snapshot({
      fresh: healthyFresh({
        recencyUnknown: true,
        neverTraded: false,
        lastTradeAgeSec: undefined,
        ageVsWindow: undefined,
      }),
    }),
  ),
  "RECHECK",
);
// The two flags are mutually exclusive by construction: absence of evidence must
// not be recorded as evidence of absence.
expect(
  "freshness: recencyUnknown forces neverTraded false",
  freshness({ expirySec: 2_000_000_000, intervalSec: 86_400, recencyUnknown: true }).neverTraded,
  false,
);
expect(
  "freshness: a successful read with no fills still reports never-traded",
  freshness({ expirySec: 2_000_000_000, intervalSec: 86_400 }).neverTraded,
  true,
);
// The window is still measurable when recency is not: expiry and elapsed come from
// the row, not from the fills query. Degrading all of freshness would have blinded
// this over an unrelated read.
expect(
  "window: still measured when trade recency is unknown",
  windowSignal(
    healthyFresh({ recencyUnknown: true, lastTradeAgeSec: undefined, secToExpiry: 2100, windowElapsed: 0.85 }),
    14_400,
  ).severity,
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

// ── depth durability ──────────────────────────────────────────────────────────
//
// The whole point of these: this venue's normal is a SOLE owner on a ~20s quote,
// so if that read as elevated the signal would fire on all 10 markets, no market
// could reach ALLOW, and the signal would carry no information — the exact shape
// of the `imbalance = 0.000` mistake the calibration sweep caught. Severity has
// to come from the parts that deviate.

console.log(`\n${BOLD}depth durability${R}`);

expect(
  "depth: sole owner on a 20s quote is this venue's normal → ok",
  depthSignal(venueDepth()).severity,
  "ok",
);
expect(
  "depth: sole owner alone never raises severity → ALLOW stays reachable",
  verdictOf(snapshot()),
  "ALLOW",
);
expect(
  "depth: the firm bucket reads 0 and says so rather than going quiet",
  /none of it committed/.test(depthSignal(venueDepth()).finding),
  true,
);
expect(
  "depth: quote about to vanish → elevated",
  depthSignal(venueDepth({ medianTtlSec: 5, minTtlSec: 4 })).severity,
  "elevated",
);
expect(
  "depth: quote at the point of vanishing → severe",
  depthSignal(venueDepth({ medianTtlSec: 1, minTtlSec: 0.5 })).severity,
  "severe",
);
// Phantom depth is the sharp end: displayed, counted by every aggregated view,
// and skipped by the matcher. A book overstating its own size is not a thin book.
expect(
  "depth: 15% past expiry → elevated",
  depthSignal(venueDepth({ phantomShares: 297, pullableShares: 1683 })).severity,
  "elevated",
);
expect(
  "depth: majority past expiry → severe",
  depthSignal(venueDepth({ phantomShares: 1200, pullableShares: 780 })).severity,
  "severe",
);
expect(
  "depth: majority past expiry → BLOCK",
  verdictOf(snapshot({ depth: venueDepth({ phantomShares: 1200, pullableShares: 780 }) })),
  "BLOCK",
);
expect(
  "depth: unreadable per-order book is unknown, not ok",
  depthSignal(null).severity,
  "unknown",
);
expect(
  "depth: unreadable per-order book withholds ALLOW",
  verdictOf(snapshot({ depth: null })),
  "RECHECK",
);
expect(
  "depth: no resting orders is unknown, not severe — liquidity owns that verdict",
  depthSignal(venueDepth({ orders: 0, totalShares: 0, bidShares: 0, askShares: 0, pullableShares: 0, byOwner: [] })).severity,
  "unknown",
);
// A second maker is the improvement this measure exists to be able to SEE.
expect(
  "depth: two owners splitting the book reports both, still ok",
  depthSignal(
    venueDepth({
      owners: 2,
      topOwnerShare: 0.6,
      concentration: 0.6 ** 2 + 0.4 ** 2,
      byOwner: [
        { owner: "0xaaa", class: "eoa", reason: "externally owned account", shares: 1188, share: 0.6, soonestTtlSec: 14 },
        { owner: "0xbbb", class: "eoa", reason: "externally owned account", shares: 792, share: 0.4, soonestTtlSec: 19 },
      ],
    }),
  ).severity,
  "ok",
);
expect(
  "depth: an opaque owner is the only class that can be firm-until-expiry",
  bucketOf("opaque", 30),
  "firm-until-expiry",
);
expect(
  "depth: an upgradeable owner is pullable, not unverified",
  bucketOf("upgradeable", 30),
  "pullable",
);
expect(
  "depth: expiry beats owner class — an expired order is phantom whoever holds it",
  bucketOf("opaque", -1),
  "phantom",
);

// ── the frozen fixture ────────────────────────────────────────────────────────

console.log(`\n${BOLD}frozen evidence${R}`);

/**
 * The one severe case here that is REAL rather than constructed.
 *
 * `capture.ts` writes `verdictAtCapture` into the fixture "so a regression shows up
 * as a diff rather than a silent change" — and then nothing ever compared it. The
 * file was written by one script and read by none, which made the strongest BLOCK in
 * the demo the only case with no gate behind it.
 *
 * Grading it is deterministic. Every clock-dependent number (the settlement lapse,
 * trade recency, the window) was resolved at capture and frozen into the snapshot, so
 * `gradeSnapshot` re-derives nothing from `Date.now()`. That matters because
 * `voidExpired()` is permissionless: the live market cannot be made to reproduce this
 * state, so the fixture is the only copy of it that will ever exist.
 *
 * A missing or unreadable fixture FAILS rather than skips. A gate that goes quiet
 * when its input disappears is the vacuous pass this audit was about.
 */
const FIXTURE_PATH = join(import.meta.dirname, "..", "fixtures", "stuck-market-c067.json");

interface FrozenFixture {
  note: string;
  capturedAtIso: string;
  indexerClaimed: { clobStatus: string | null; disagreesWithChain: boolean };
  snapshot: MarketSnapshot;
  verdictAtCapture: {
    verdict: Verdict;
    confidence: number;
    action: string;
    rules: { rule: string; because: string }[];
    severities: { id: string; severity: string }[];
  };
}

let fixture: FrozenFixture | null = null;
try {
  fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as FrozenFixture;
} catch (e) {
  const why = e instanceof Error ? e.message : String(e);
  failures.push(`frozen fixture is unreadable, so the committed BLOCK case is unverified: ${why}`);
  console.log(`  ${RED}✗${R} frozen fixture could not be read ${DIM}${why}${R}`);
}

if (fixture) {
  const regraded = gradeSnapshot(fixture.snapshot);
  const recorded = fixture.verdictAtCapture;
  console.log(`  ${DIM}captured ${fixture.capturedAtIso}${R}`);

  // Against the recording: engine drift shows up here as a diff, which is what the
  // recording was for.
  expect("fixture: verdict unchanged since capture", regraded.verdict, recorded.verdict);
  expect("fixture: confidence unchanged since capture", regraded.confidence, recorded.confidence);
  expect("fixture: action unchanged since capture", regraded.action, recorded.action);
  expect(
    "fixture: the same rules fire, in the same order",
    regraded.rules.map((r) => r.rule),
    recorded.rules.map((r) => r.rule),
  );
  expect(
    "fixture: every signal severity unchanged",
    regraded.signals.map((s) => ({ id: s.id, severity: s.severity })),
    recorded.severities,
  );

  // And against the CASE itself, so the gate still asserts something real if the
  // fixture is ever re-captured and the recording moves with it.
  expect("fixture: the stuck market is BLOCK", regraded.verdict, "BLOCK");
  expect("fixture: nothing may be executed on it", regraded.action, "do_not_execute");
  expect("fixture: the chain says it is not tradable", fixture.snapshot.onchain.value?.tradable, false);
  expect("fixture: not-trading is the first rule", regraded.rules[0]?.rule, "not-trading");
  expect(
    "fixture: the lapsed settlement window is severe",
    regraded.signals.find((s) => s.id === "resolution")?.severity,
    "severe",
  );
  expect(
    "fixture: the indexer contradicted the chain, which is the whole case",
    fixture.indexerClaimed.disagreesWithChain,
    true,
  );
}

// ── result ────────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}result${R}`);
if (failures.length === 0) {
  console.log(`  ${GRN}PASS${R} ${passed} assertions`);
  process.exit(0);
}
for (const f of failures) console.log(`  ${RED}FAIL${R} ${f}`);
console.log(`  ${RED}${failures.length} failed${R}, ${passed} passed`);
process.exit(1);
