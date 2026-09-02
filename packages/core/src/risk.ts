/**
 * Deterministic risk engine. Computes every metric in code; the LLM never
 * invents a number and never predicts an outcome.
 *
 * ALL THRESHOLDS BELOW ARE CALIBRATED against measured distributions on this
 * venue (`npm run calibrate`), not against intuition about real-money order
 * books. That distinction is load-bearing: this venue's maker ladder quotes a
 * 2.1-2.9 point spread with ~990 shares a side, and the deepest market on the
 * board routinely sits 40 minutes without a trade. Thresholds picked for a normal
 * book grade every market BLOCK, and a verdict that fires on everything says
 * nothing.
 *
 * Two corrections the calibration sweep forced, both counter-intuitive:
 *
 * 1. SPREAD-AS-A-FRACTION-OF-MID IS UNUSABLE AT THE TAILS. Measured: a market at
 *    mid 0.019 carrying a 0.021 spread scores 113% — and one at mid 0.033 scores
 *    65% — while identical absolute spreads on mid 0.4 score 7%. Normalizing by
 *    mid makes cheap markets look catastrophic purely because the denominator is
 *    small. For a binary contract the payoff is fixed at 0 or 1, so an absolute
 *    spread in probability points IS the economically meaningful measure: 2 points
 *    costs 2% of max payout wherever the mid sits. Absolute points are primary
 *    here; the ratio is kept for display only.
 *
 * 2. SPREAD WIDER THAN MID IS ITS OWN, SEVERE CONDITION. At mid 0.019 with a
 *    0.021 spread, a round trip costs more than the position can ever return.
 *    That is not "wide" — it is unplayable, and it needs to be caught explicitly
 *    rather than folded into a ratio band.
 */

import type { BookMetrics } from "./book";
import type { DepthMetrics } from "./depth";
import type { FlowMetrics, Freshness, MoveMetrics } from "./history";
import type { MarketSnapshot, ResolutionState } from "./snapshot";

/**
 * How bad one dimension looks.
 *
 * `unknown` is deliberately NOT a severity level — it is the absence of one. A
 * signal we could not measure must never be scored as healthy, and must never be
 * scored as dangerous either.
 */
export type Severity = "ok" | "elevated" | "severe" | "unknown";

export type Verdict = "ALLOW" | "RECHECK" | "BLOCK";

export interface Signal {
  /** Stable id, safe to key UI and prompts on. */
  id: SignalId;
  label: string;
  severity: Severity;
  /** One plain sentence, stating the measured value. Shown to the user verbatim. */
  finding: string;
  /** The numbers behind the finding, for the decision trace. */
  evidence: Record<string, number | string | boolean | null>;
  /** Why this threshold, in one line — the calibration justification. */
  basis: string;
}

/**
 * Every signal id, in the order the engine evaluates them.
 *
 * THE SINGLE SOURCE OF TRUTH, and it has to be, because the explanation layer's
 * JSON schema constrains `signal_id` to an enum. That enum was a hand-copied
 * duplicate of this list, and adding `depth` silently broke the model path
 * everywhere: Groq's strict decoding rejected the response, every market fell
 * back to the deterministic narrator, and the Stage 5 gate still reported PASS
 * because the fallback is meant to work. The only visible trace was the
 * fallback-reason field. Deriving both from here makes that drift impossible.
 */
export const SIGNAL_IDS = [
  "venue",
  "resolution",
  "liquidity",
  "depth",
  "volatility",
  "staleness",
  "window",
  "manipulation",
] as const;

export type SignalId = (typeof SIGNAL_IDS)[number];

/**
 * Calibrated cut points. Every number here is justified by a measured
 * distribution; the comment is the justification, not decoration.
 */
export const THRESHOLDS = {
  /**
   * Absolute spread in probability points. Measured across the venue:
   * min 0.021, p25 0.024, median 0.026, max 0.029 — the maker ladder holds a
   * remarkably tight band. So the venue's OWN normal is ~2-3 points, and
   * "elevated" has to sit above that band rather than at a textbook 1 point.
   */
  spreadElevated: 0.035,
  spreadSevere: 0.06,

  /**
   * Spread relative to mid, used ONLY to catch the unplayable tail (see the file
   * header). At 1.0 a round trip costs the entire maximum payout.
   */
  spreadOverMidSevere: 0.9,
  spreadOverMidElevated: 0.5,

  /**
   * Executable shares within 0.05 of the touch. Measured: median 990 on both
   * sides, with genuine zeros on markets whose book has not been quoted yet.
   * A market with under 50 shares cannot absorb even a small position.
   */
  depthElevated: 200,
  depthSevere: 50,

  /**
   * Largest close-to-close move between consecutive candles, in points.
   * Measured n=4: min 0.096, median 0.117, max 0.130. Every market with enough
   * samples showed a ~10 point step, so 10 points is NORMAL here and cannot be
   * the alarm. Alarm above the observed max.
   */
  moveElevated: 0.15,
  moveSevere: 0.25,

  /**
   * Last-trade age as a fraction of the market's own window. Measured: median
   * 0.040, p75 0.282, max 0.557. Expressed relative to the window because the
   * same 40 minutes is nothing in a 24h market and terminal in a 15m one.
   */
  staleElevated: 0.35,
  staleSevere: 0.6,

  /**
   * Fraction of the trading window elapsed. Past 0.9 a market can lock between
   * our snapshot and any action taken on it — the venue's own strategies scale
   * their headroom to the series interval for exactly this reason.
   */
  windowElapsedElevated: 0.8,
  windowElapsedSevere: 0.92,

  /** Absolute floor on remaining time, whatever the window length. */
  secToExpiryElevated: 300,
  secToExpirySevere: 90,

  /**
   * One-sidedness of aggressive flow. Measured: min -1.00, p25 -0.15,
   * median 0.10, p75 1.00, max 1.00 — range 2.0, the WIDEST-ranging metric on the
   * venue and therefore the one carrying real information.
   *
   * Depth imbalance, the textbook manipulation signal, is 0.000 on every
   * properly-quoted market because the maker ladder is symmetric by construction.
   * It only moves when one side is partially consumed. So flow skew is primary
   * and imbalance is corroboration, which inverts the usual arrangement.
   *
   * `skewSevere` is NOT reachable by flow alone — see `manipulationSignal`. Severe
   * requires flow and resting depth to agree, because one-sided flow on its own is
   * ordinary momentum and blocking on it would make BLOCK meaningless.
   */
  skewElevated: 0.6,
  skewSevere: 0.9,
  /** Skew on a handful of fills is noise, not pressure. */
  skewMinFills: 3,

  /** Depth imbalance, secondary. Measured: one real reading of -0.547. */
  imbalanceElevated: 0.4,
  imbalanceSevere: 0.7,

  /** Candles needed before a volatility claim means anything. */
  minCandles: 3,

  /**
   * Seconds until the median resting order expires.
   *
   * Measured on this venue, all 10 live markets, twice: order TTLs run 11-28s
   * and the maker reposts continuously. So a ~20s quote is this venue's NORMAL
   * and cannot be the alarm — same shape as the spread calibration. The alarm
   * sits BELOW the measured floor, where the displayed book is about to be gone
   * rather than merely short-lived.
   */
  quoteTtlElevated: 8,
  quoteTtlSevere: 2,

  /**
   * Fraction of displayed depth already past `expireTimestampNs`.
   *
   * The sharp end of the depth read. `getBookLevels` and every aggregated view
   * still count these shares, but the matching loop skips an expired maker, so
   * they are displayed liquidity that provably cannot be filled — before any
   * keeper sweeps them. Measured 0 on every market so far, which is why any
   * material reading is a deviation worth surfacing.
   */
  phantomDepthElevated: 0.1,
  phantomDepthSevere: 0.5,

  /**
   * Single-owner share of displayed depth.
   *
   * Measured 1.00 on all 10 live markets — one dedicated maker address per
   * market, quoting both sides. It is therefore a venue CONSTANT, and a signal
   * that fires on every market says nothing, so this never raises severity on
   * its own. It is reported on every market because it is the single most
   * useful fact the per-order read recovers, and it corroborates a short TTL:
   * a sole owner whose whole quote expires at once leaves nothing behind it.
   */
  soleOwnerShare: 0.99,
} as const;

/** The venue carrying real DreamDEX event contracts (operatorId 2). */
export const DREAMDEX_VENUE_ID =
  "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";

const pts = (v: number) => `${(v * 100).toFixed(1)} points`;

/**
 * A duration in the largest unit that stays readable.
 *
 * Exists because the old code rendered every lapse in minutes, and the stuck
 * market on our own venue came out as "expired 6328 min ago". That is a correct
 * number that no human reads as four and a half days, and a trace full of
 * figures nobody can parse is what makes an engine look machine-generated
 * however sound its arithmetic.
 */
export function humanDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 90) return `${s}s`;
  if (s < 5_400) return `${Math.round(s / 60)} min`;
  if (s < 172_800) {
    const h = Math.floor(s / 3_600);
    const m = Math.round((s % 3_600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(s / 86_400);
  const h = Math.round((s % 86_400) / 3_600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

const worst = (a: Severity, b: Severity): Severity => {
  const rank: Record<Severity, number> = { ok: 0, unknown: 1, elevated: 2, severe: 3 };
  return rank[a] >= rank[b] ? a : b;
};

/**
 * Liquidity: can a position actually be entered and exited?
 *
 * Absolute spread leads, because a binary contract's payoff is fixed at 0 or 1 —
 * two points of spread costs 2% of maximum payout wherever the mid sits. The
 * ratio only enters to catch the unplayable tail, where the spread approaches or
 * exceeds the mid itself.
 */
export function liquiditySignal(book: BookMetrics | null, resting: DepthMetrics | null = null): Signal {
  const base = {
    id: "liquidity" as const,
    label: "Liquidity",
    basis:
      "Venue spreads measured 0.021-0.029 points (median 0.026), executable depth median 990 shares. " +
      "Absolute points lead because a binary payoff is fixed at 0/1; the mid-ratio only catches the unplayable tail.",
  };

  if (!book) {
    return { ...base, severity: "unknown", finding: "Order book could not be read.", evidence: {} };
  }
  if (book.unusable === "crossed") {
    // A crossed materialized book means the READ is wrong, not the market.
    return {
      ...base,
      severity: "unknown",
      finding: `Order book read back crossed (bid ${book.bid.best?.toFixed(3)} at or above ask ${book.ask.best?.toFixed(3)}), which cannot occur. The data is untrustworthy, not the market.`,
      evidence: { bid: book.bid.best ?? null, ask: book.ask.best ?? null, crossed: true },
    };
  }

  // A book reading empty or one-sided is strong evidence for BLOCK, and usually
  // right: the venue rolls windows continuously and a fresh generation genuinely has
  // no maker on it yet. But the snapshot already carries an INDEPENDENT per-order
  // chain read, taken seconds later in the same pass, and when that read finds live
  // orders resting on both sides it is the aggregated book that is wrong rather than
  // the market. That is the same call as the crossed branch above, on the same
  // grounds, so it gets the same answer: report the read as untrustworthy instead of
  // grading a market on it. The verdict becomes RECHECK with "re-read the order book"
  // attached, which is the actionable truth.
  //
  // Deliberately narrow, on three counts. It applies only to the categorical
  // disagreements, because `DepthMetrics` carries no price levels and so cannot
  // corroborate near-touch thinness (and on this venue near-touch depth measures 990
  // or nothing, never in between). It requires shares on both sides plus live shares
  // overall, since phantom depth is not broken out per side. And a missing or degraded
  // depth read never downgrades anything: absence of corroboration is not
  // corroboration.
  const liveShares = resting === null ? 0 : resting.totalShares - resting.phantomShares;
  if (
    (book.unusable === "empty" || book.unusable === "one-sided") &&
    resting !== null &&
    resting.orders > 0 &&
    resting.bidShares > 0 &&
    resting.askShares > 0 &&
    liveShares > 0
  ) {
    return {
      ...base,
      severity: "unknown",
      finding:
        `The aggregated book read back ${book.unusable}, but the per-order chain read from the same pass found ` +
        `${liveShares.toFixed(0)} live shares across ${resting.orders} orders with both sides quoted. Two independent ` +
        `sources disagree, so tradability here is unread rather than absent.`,
      evidence: {
        bookUnusable: book.unusable,
        bookBidLevels: book.bid.levels,
        bookAskLevels: book.ask.levels,
        chainOrders: resting.orders,
        chainBidShares: Number(resting.bidShares.toFixed(2)),
        chainAskShares: Number(resting.askShares.toFixed(2)),
        chainLiveShares: Number(liveShares.toFixed(2)),
        chainPhantomShares: Number(resting.phantomShares.toFixed(2)),
        sourcesDisagree: true,
      },
    };
  }

  if (book.unusable === "empty") {
    return {
      ...base,
      severity: "severe",
      finding: "No orders resting on either side, so nothing can be executed.",
      evidence: { bidLevels: 0, askLevels: 0 },
    };
  }
  if (book.unusable === "one-sided") {
    const side = book.bid.best === undefined ? "bid" : "ask";
    return {
      ...base,
      severity: "severe",
      finding: `Only one side of the book is quoted (no ${side}), so a position could be opened but not closed.`,
      evidence: {
        bidLevels: book.bid.levels,
        askLevels: book.ask.levels,
        missing: side,
      },
    };
  }

  const spread = book.spread ?? 0;
  const ratio = book.spreadPct ?? 0;
  const depth = Math.min(book.bid.nearShares, book.ask.nearShares);
  /**
   * Rounded to the venue's tick grid, like every other figure here.
   *
   * These three were the only raw floats in any evidence object, and it showed on
   * screen: `mid` is `(bid + ask) / 2`, so a 0.058/0.061 touch produced
   * `0.0595000000000000004`, and because the explanation layer is handed the
   * evidence verbatim, that IEEE-754 tail was quoted back inside a model-written
   * sentence: "0.021 points on a 0.0595000000000000004 mid". A product whose whole
   * claim is that every number traces to a measurement cannot print binary
   * floating-point noise in prose. Three decimals is the venue's own price
   * resolution, which is what `prob()` renders in the UI too.
   */
  const evidence = {
    bid: book.bid.best === undefined ? null : Number(book.bid.best.toFixed(3)),
    ask: book.ask.best === undefined ? null : Number(book.ask.best.toFixed(3)),
    mid: book.mid === undefined ? null : Number(book.mid.toFixed(3)),
    spreadPoints: Number(spread.toFixed(4)),
    spreadOverMid: Number(ratio.toFixed(3)),
    nearBidShares: Number(book.bid.nearShares.toFixed(2)),
    nearAskShares: Number(book.ask.nearShares.toFixed(2)),
    thinnerSideShares: Number(depth.toFixed(2)),
  };

  // The unplayable case first: it is the most severe and the most specific.
  if (ratio >= THRESHOLDS.spreadOverMidSevere) {
    return {
      ...base,
      severity: "severe",
      finding: `The spread (${pts(spread)}) is ${(ratio * 100).toFixed(0)}% of the ${book.mid?.toFixed(3)} mid, so a round trip costs about as much as the contract can ever pay.`,
      evidence,
    };
  }

  let severity: Severity = "ok";
  const notes: string[] = [];

  if (spread >= THRESHOLDS.spreadSevere) {
    severity = worst(severity, "severe");
    notes.push(`spread ${pts(spread)}, roughly double the venue's normal 2.6`);
  } else if (spread >= THRESHOLDS.spreadElevated) {
    severity = worst(severity, "elevated");
    notes.push(`spread ${pts(spread)}, above the venue's usual 2.1-2.9 band`);
  }

  if (ratio >= THRESHOLDS.spreadOverMidElevated) {
    severity = worst(severity, "elevated");
    notes.push(`that spread is ${(ratio * 100).toFixed(0)}% of a low ${book.mid?.toFixed(3)} mid`);
  }

  if (depth <= THRESHOLDS.depthSevere) {
    severity = worst(severity, "severe");
    notes.push(`only ${depth.toFixed(0)} shares within ${pts(book.nearBand)} of the touch on the thinner side`);
  } else if (depth <= THRESHOLDS.depthElevated) {
    severity = worst(severity, "elevated");
    notes.push(`${depth.toFixed(0)} shares near the touch on the thinner side, against a venue median of 990`);
  }

  if (severity === "ok") {
    return {
      ...base,
      severity,
      finding: `Spread is ${pts(spread)} on a ${book.mid?.toFixed(3)} mid with ${depth.toFixed(0)} shares near the touch, in line with this venue.`,
      evidence,
    };
  }
  return { ...base, severity, finding: `${notes.join("; ")}.`, evidence };
}

/**
 * Depth durability: is the displayed book a commitment, and can it be filled?
 *
 * The only signal here with no off-chain equivalent, because `owner` and
 * `expireTimestampNs` exist per order on the chain read and nowhere else — every
 * aggregated view sums them away. See depth.ts for the mechanism and the
 * measurements.
 *
 * WHAT MOVES THE VERDICT, and what deliberately does not:
 *
 *   phantom depth        moves it. Shares past their own expiry are still
 *                        displayed and still counted by `getBookLevels`, but the
 *                        matcher skips an expired maker — so they cannot be
 *                        filled. A book overstating its own size is the one
 *                        reading here you must not size a position against.
 *   quote TTL            moves it BELOW the venue's measured 11-28s floor, where
 *                        the book is about to be empty rather than merely
 *                        short-lived.
 *   owner concentration  does NOT move it. It measures 1.00 on all 10 live
 *                        markets — one maker address per market by construction —
 *                        and a signal constant across a venue cannot
 *                        discriminate, whatever it sounds like. It is stated on
 *                        every market anyway, because it is the most useful thing
 *                        the read recovers and no other view can show it.
 *   the firm bucket      does NOT move it, and reads 0% here for four separate
 *                        verified reasons (depth.ts). Reported because being able
 *                        to say why the answer is zero IS the claim.
 */
export function depthSignal(d: DepthMetrics | null): Signal {
  const base = {
    id: "depth" as const,
    label: "Depth durability",
    basis:
      "Per-order `owner` and `expireTimestampNs` from getAllOpenOrdersOffChain: fields every aggregated view sums away. " +
      "Measured on all 10 live markets, twice: 1 owner holding 100% of both sides, 6 orders, TTL 11-28s, 0 shares past " +
      "expiry. So a ~20s quote and a sole owner are this venue's normal and cannot be the alarm; phantom depth and a " +
      "sub-8s TTL are the deviations.",
  };

  if (!d) {
    return {
      ...base,
      severity: "unknown",
      finding:
        "Per-order resting depth could not be read, so nothing can be said about whether the displayed book is fillable.",
      evidence: {},
    };
  }

  const evidence = {
    orders: d.orders,
    owners: d.owners,
    totalShares: Number(d.totalShares.toFixed(2)),
    topOwnerShare: Number(d.topOwnerShare.toFixed(3)),
    concentration: Number(d.concentration.toFixed(3)),
    medianTtlSec: d.medianTtlSec === null ? null : Number(d.medianTtlSec.toFixed(1)),
    minTtlSec: d.minTtlSec === null ? null : Number(d.minTtlSec.toFixed(1)),
    firmShares: Number(d.firmShares.toFixed(2)),
    pullableShares: Number(d.pullableShares.toFixed(2)),
    unverifiedShares: Number(d.unverifiedShares.toFixed(2)),
    phantomShares: Number(d.phantomShares.toFixed(2)),
    topOwner: d.byOwner[0]?.owner ?? null,
    topOwnerClass: d.byOwner[0]?.class ?? null,
  };

  if (d.orders === 0) {
    // Not the same as "the book is thin" — there is nothing to measure the
    // durability OF. `liquiditySignal` already owns the empty-book verdict, so
    // this reports absence rather than double-counting it as risk.
    return {
      ...base,
      severity: "unknown",
      finding:
        "No orders are resting on either side, so there is no displayed depth to judge the durability of.",
      evidence,
    };
  }

  const phantomFrac = d.totalShares > 0 ? d.phantomShares / d.totalShares : 0;
  const ttl = d.medianTtlSec ?? 0;
  const sole = d.topOwnerShare >= THRESHOLDS.soleOwnerShare;
  const pullablePct = (d.pullableShares / Math.max(d.totalShares, 1e-9)) * 100;

  // How the book is held, stated the same way at every severity — the numbers are
  // the content, and they should not appear only when something is wrong.
  const composition =
    `${d.totalShares.toFixed(0)} shares across ${d.orders} order${d.orders === 1 ? "" : "s"}, ` +
    (sole
      ? `all of it owned by one address (${d.byOwner[0]?.reason ?? "owner unclassified"})`
      : `held by ${d.owners} owners, the largest ${(d.topOwnerShare * 100).toFixed(0)}%`) +
    `. ${pullablePct.toFixed(0)}% is withdrawable at will` +
    (d.firmShares > 0
      ? `, ${((d.firmShares / d.totalShares) * 100).toFixed(0)}% firm only until its own expiry`
      : ", none of it committed") +
    `.`;

  if (phantomFrac >= THRESHOLDS.phantomDepthSevere) {
    return {
      ...base,
      severity: "severe",
      finding:
        `${(phantomFrac * 100).toFixed(0)}% of the displayed depth (${d.phantomShares.toFixed(0)} shares) is already past its own ` +
        `expiry and cannot be matched against, so the book is overstating its size by more than half. ${composition}`,
      evidence,
    };
  }
  if (phantomFrac >= THRESHOLDS.phantomDepthElevated) {
    return {
      ...base,
      severity: "elevated",
      finding:
        `${d.phantomShares.toFixed(0)} of ${d.totalShares.toFixed(0)} displayed shares (${(phantomFrac * 100).toFixed(0)}%) are past ` +
        `expiry and unfillable, though still counted by every aggregated view. ${composition}`,
      evidence,
    };
  }
  if (ttl <= THRESHOLDS.quoteTtlSevere) {
    return {
      ...base,
      severity: "severe",
      finding:
        `The median resting order expires in ${ttl.toFixed(0)}s, so the displayed book is at the point of vanishing, ` +
        `well inside this venue's measured 11-28s floor. ${composition}`,
      evidence,
    };
  }
  if (ttl <= THRESHOLDS.quoteTtlElevated) {
    return {
      ...base,
      severity: "elevated",
      finding:
        `The median resting order expires in ${ttl.toFixed(0)}s, below this venue's measured 11-28s floor` +
        (sole ? ", and there is no second owner quoting behind it" : "") +
        `. ${composition}`,
      evidence,
    };
  }
  return {
    ...base,
    severity: "ok",
    finding:
      `Quotes are short-lived but in line with this venue: the median resting order expires in ${ttl.toFixed(0)}s ` +
      `and nothing displayed is past expiry. ${composition}`,
    evidence,
  };
}

/**
 * Volatility: did the implied probability move sharply?
 *
 * Measured BETWEEN candles, never within one. Candles here are emitted per trade
 * rather than per interval, so most carry `open == high == low == close` and
 * intra-candle range is structurally zero — a range-based measure would report
 * perfect calm on a market that moved 20 points.
 */
export function volatilitySignal(move: MoveMetrics | null): Signal {
  const base = {
    id: "volatility" as const,
    label: "Volatility",
    basis:
      "Close-to-close between consecutive candles (buckets are per-trade, so intra-candle range is structurally zero). " +
      "Measured max step 0.096-0.130 across markets with enough samples, so ~10 points is this venue's normal.",
  };

  if (!move) {
    return { ...base, severity: "unknown", finding: "Price history could not be read.", evidence: {} };
  }
  if (move.insufficient) {
    // Common, not exceptional: most intraday markets have 0-2 candles.
    return {
      ...base,
      severity: "unknown",
      finding:
        move.samples === 0
          ? "No trades have printed, so there is no price history to measure a move against."
          : `Only ${move.samples} price bucket${move.samples === 1 ? "" : "s"} exist${move.samples === 1 ? "s" : ""}, fewer than the ${THRESHOLDS.minCandles} needed to judge a move.`,
      evidence: { samples: move.samples, required: THRESHOLDS.minCandles },
    };
  }

  const step = move.maxStep ?? 0;
  const evidence = {
    maxStepPoints: Number(step.toFixed(4)),
    netChangePoints: Number((move.netChange ?? 0).toFixed(4)),
    samples: move.samples,
    spanSec: move.spanSec,
    volumeShares: Number(move.volume.toFixed(2)),
  };

  if (step >= THRESHOLDS.moveSevere) {
    return {
      ...base,
      severity: "severe",
      finding: `Implied probability jumped ${pts(step)} between consecutive trades, well beyond the ~13 points seen elsewhere on this venue.`,
      evidence,
    };
  }
  if (step >= THRESHOLDS.moveElevated) {
    return {
      ...base,
      severity: "elevated",
      finding: `Implied probability moved ${pts(step)} in one step, above the venue's typical 10.`,
      evidence,
    };
  }
  return {
    ...base,
    severity: "ok",
    finding: `Largest step between trades is ${pts(step)}, net ${pts(move.netChange ?? 0)} across ${move.samples} buckets.`,
    evidence,
  };
}

/**
 * Staleness: is the price current enough to trust?
 *
 * Always relative to the market's own window. A fixed "stale after 5 minutes"
 * rule grades every market on this venue stale — the deepest book on the board
 * measured 42 minutes since its last trade — and a signal that always fires
 * carries no information.
 */
export function stalenessSignal(fresh: Freshness | null, windowSec: number | null): Signal {
  const base = {
    id: "staleness" as const,
    label: "Staleness",
    basis:
      "Last-trade age as a fraction of the market's own window. Measured median 0.040, p75 0.282, max 0.557. " +
      "absolute age is meaningless across a venue running 5m to 24h series.",
  };

  if (!fresh) {
    return { ...base, severity: "unknown", finding: "Trade recency could not be established.", evidence: {} };
  }

  const mins = (s: number) => `${Math.round(s / 60)} min`;

  // Checked BEFORE `neverTraded`, because the two used to be the same state. When
  // the fills read failed and the indexed row carried no `lastTradeAt`, freshness
  // reported `neverTraded: true` and this signal published "this market has never
  // traded, so its quoted mid reflects a maker's opening guess" — a measured-sounding
  // claim about the market, produced by a read that did not land. Unmeasured is not
  // reassuring, and it is not damning either.
  if (fresh.recencyUnknown) {
    return {
      ...base,
      severity: "unknown",
      finding:
        "Trade recency could not be established: the fills read did not land and the indexed row carries no last-trade time. This is a gap in observation, not a quiet market.",
      evidence: { recencyUnknown: true, secToExpiry: fresh.secToExpiry },
    };
  }

  if (fresh.neverTraded) {
    // Not the same as stale: there is no price to be stale. Any mid is the maker's
    // opening guess, not a market consensus.
    return {
      ...base,
      severity: "elevated",
      finding: "This market has never traded, so its quoted mid reflects a maker's opening guess rather than any consensus.",
      evidence: { neverTraded: true, secToExpiry: fresh.secToExpiry },
    };
  }

  const rel = fresh.ageVsWindow;
  const evidence = {
    lastTradeAgeSec: fresh.lastTradeAgeSec ?? null,
    ageVsWindow: rel === undefined ? null : Number(rel.toFixed(3)),
    windowSec: windowSec ?? null,
  };

  if (rel === undefined) {
    return {
      ...base,
      severity: "unknown",
      finding: `Last trade was ${mins(fresh.lastTradeAgeSec ?? 0)} ago, but the window length is unknown so this cannot be judged.`,
      evidence,
    };
  }
  if (rel >= THRESHOLDS.staleSevere) {
    return {
      ...base,
      severity: "severe",
      finding: `No trade for ${mins(fresh.lastTradeAgeSec ?? 0)}, ${(rel * 100).toFixed(0)}% of this market's entire window.`,
      evidence,
    };
  }
  if (rel >= THRESHOLDS.staleElevated) {
    return {
      ...base,
      severity: "elevated",
      finding: `Last trade was ${mins(fresh.lastTradeAgeSec ?? 0)} ago, ${(rel * 100).toFixed(0)}% of the window.`,
      evidence,
    };
  }
  return {
    ...base,
    severity: "ok",
    finding: `Last trade ${mins(fresh.lastTradeAgeSec ?? 0)} ago, ${(rel * 100).toFixed(0)}% of the window.`,
    evidence,
  };
}

/**
 * Window: is there enough time left to act on this at all?
 *
 * Specific to event contracts, and absent from the original spec. A window can
 * lock between the snapshot and any action taken on it, at which point orders are
 * refused — so remaining time is a first-class risk, not a display detail.
 */
export function windowSignal(fresh: Freshness | null, windowSec: number | null): Signal {
  const base = {
    id: "window" as const,
    label: "Window",
    basis:
      "Time to expiry, absolute and as a fraction of the window. Only `Trading` accepts orders and the transition is " +
      "time-derived on-chain, so a market can lock between snapshot and action.",
  };

  if (!fresh) {
    return { ...base, severity: "unknown", finding: "Time to expiry could not be established.", evidence: {} };
  }

  const left = fresh.secToExpiry;
  const elapsed = fresh.windowElapsed;
  const evidence = {
    secToExpiry: left,
    windowElapsed: elapsed === undefined ? null : Number(elapsed.toFixed(3)),
    windowSec: windowSec ?? null,
  };
  const human = left < 0 ? "already past expiry" : left < 90 ? `${left}s` : `${Math.round(left / 60)} min`;

  if (left <= 0) {
    return {
      ...base,
      severity: "severe",
      finding: "The trading window has closed; no new orders are accepted.",
      evidence,
    };
  }
  if (left <= THRESHOLDS.secToExpirySevere) {
    return {
      ...base,
      severity: "severe",
      finding: `Only ${human} of trading left; the market can lock before an order lands.`,
      evidence,
    };
  }
  // Two independent ways a window becomes risky, and BOTH have to be checked:
  // an absolute shortage of time, or a large fraction of the window already
  // spent. A live run graded "35 min of trading left, 85% of the window elapsed"
  // as ok because only the SEVERE elapsed threshold was wired in and
  // `windowElapsedElevated` sat unused — declared at 0.8 and never read. 85% is
  // past the point where the calibration says to look closer.
  if ((elapsed ?? 0) >= THRESHOLDS.windowElapsedSevere) {
    return {
      ...base,
      severity: "severe",
      finding: `${(((elapsed ?? 0) * 100)).toFixed(0)}% of the window has elapsed with ${human} left; the market can lock before an order lands.`,
      evidence,
    };
  }
  if (left <= THRESHOLDS.secToExpiryElevated || (elapsed ?? 0) >= THRESHOLDS.windowElapsedElevated) {
    return {
      ...base,
      severity: "elevated",
      finding: `${human} of trading left${elapsed !== undefined ? `, ${(elapsed * 100).toFixed(0)}% of the window elapsed` : ""}.`,
      evidence,
    };
  }
  return {
    ...base,
    severity: "ok",
    finding: `${human} of trading left${elapsed !== undefined ? `, ${(elapsed * 100).toFixed(0)}% of the window elapsed` : ""}.`,
    evidence,
  };
}

/**
 * Manipulation: is order flow one-sided in a way the book does not justify?
 *
 * FLOW SKEW LEADS, DEPTH IMBALANCE CORROBORATES — the inverse of the textbook
 * arrangement, and the calibration sweep is why. Imbalance measured exactly 0.000
 * on every properly-quoted market, because the maker ladder is symmetric by
 * construction; it only moves once one side is partially consumed. A signal that
 * is constant across a venue cannot discriminate, however sensible it sounds.
 * Flow skew ranged the full -1.00 to +1.00, the widest of any metric measured.
 */
export function manipulationSignal(
  flow: FlowMetrics | null,
  book: BookMetrics | null,
): Signal {
  const base = {
    id: "manipulation" as const,
    label: "Order flow",
    basis:
      "Taker-side skew leads because depth imbalance measured 0.000 on every symmetrically-quoted market, so it cannot " +
      "discriminate here. Skew ranged -1.00 to +1.00 across the venue, the widest of any metric.",
  };

  if (!flow) {
    return { ...base, severity: "unknown", finding: "Trade flow could not be read.", evidence: {} };
  }
  if (flow.count === 0) {
    return {
      ...base,
      severity: "unknown",
      finding: "No trades yet, so there is no flow to assess.",
      evidence: { fills: 0 },
    };
  }

  const skew = flow.skew;
  const imbalance = book?.imbalance;
  const evidence = {
    fills: flow.count,
    takerBuyShares: Number(flow.takerBuyShares.toFixed(2)),
    takerSellShares: Number(flow.takerSellShares.toFixed(2)),
    skew: skew === undefined ? null : Number(skew.toFixed(3)),
    depthImbalance: imbalance === undefined ? null : Number(imbalance.toFixed(3)),
    mintedShares: Number(flow.mintedShares.toFixed(2)),
    vwap: flow.vwap === undefined ? null : Number(flow.vwap.toFixed(4)),
  };

  // Skew on two fills is arithmetic, not pressure — it is ±1.00 by construction.
  if (flow.count < THRESHOLDS.skewMinFills) {
    return {
      ...base,
      severity: "unknown",
      finding: `Only ${flow.count} fill${flow.count === 1 ? "" : "s"} recorded, too few to read direction from (any single-sided pair scores as total one-sidedness).`,
      evidence,
    };
  }

  let severity: Severity = "ok";
  const notes: string[] = [];
  const dir = (skew ?? 0) > 0 ? "buying" : "selling";
  const mag = Math.abs(skew ?? 0);
  const im = imbalance === undefined ? undefined : Math.abs(imbalance);

  // ONE INDICATOR IS SUSPICION; TWO AGREEING INDICATORS ARE EVIDENCE.
  //
  // Flow skew alone never reaches severe, however extreme. A market where every
  // recent taker bought is showing directional pressure — which is information
  // worth surfacing — but it is not proof of manipulation and the market remains
  // perfectly tradable. BLOCK has to mean "cannot or must not trade"; if
  // one-sided flow blocked on its own, BLOCK would fire on ordinary momentum and
  // stop meaning anything.
  //
  // Severe requires flow AND resting depth to agree, which is the pattern that
  // actually looks like someone working the book: aggressive one-way flow into a
  // book that is also lopsided. That also puts imbalance to its proper use — it is
  // constant at 0.000 on symmetrically-quoted markets, so it is useless as a
  // primary trigger but a meaningful corroborator when it does move.
  const flowExtreme = mag >= THRESHOLDS.skewSevere;
  const depthExtreme = im !== undefined && im >= THRESHOLDS.imbalanceElevated;

  if (flowExtreme && depthExtreme) {
    severity = worst(severity, "severe");
    notes.push(
      `all recent aggressive flow is ${dir} (skew ${(skew ?? 0).toFixed(2)}) into a book already ${((im ?? 0) * 100).toFixed(0)}% skewed to the ${(imbalance ?? 0) > 0 ? "bid" : "ask"}`,
    );
  } else {
    if (flowExtreme) {
      severity = worst(severity, "elevated");
      notes.push(`every recent fill is aggressive ${dir} (skew ${(skew ?? 0).toFixed(2)}) across ${flow.count} trades`);
    } else if (mag >= THRESHOLDS.skewElevated) {
      severity = worst(severity, "elevated");
      notes.push(`aggressive flow is ${(mag * 100).toFixed(0)}% one-sided toward ${dir}`);
    }
    if (im !== undefined && im >= THRESHOLDS.imbalanceSevere) {
      severity = worst(severity, "elevated");
      notes.push(`resting depth is ${(im * 100).toFixed(0)}% skewed to the ${(imbalance ?? 0) > 0 ? "bid" : "ask"}`);
    } else if (im !== undefined && im >= THRESHOLDS.imbalanceElevated) {
      severity = worst(severity, "elevated");
      notes.push(`resting depth leans ${(im * 100).toFixed(0)}% to the ${(imbalance ?? 0) > 0 ? "bid" : "ask"}`);
    }
  }

  if (severity === "ok") {
    const minted =
      flow.mintedShares > 0
        ? ` ${flow.mintedShares.toFixed(0)} shares came from opposite-side buyers minting a pair rather than a seller.`
        : "";
    return {
      ...base,
      severity,
      finding: `Flow is roughly balanced (skew ${(skew ?? 0).toFixed(2)}) over ${flow.count} trades.${minted}`,
      evidence,
    };
  }
  return { ...base, severity, finding: `${notes.join("; ")}.`, evidence };
}

/**
 * Resolution: can this market settle cleanly?
 *
 * NOT wording-based. Every market on this venue asks the same templated question
 * ("BTC closes at or above its opening price") and the docs are explicit that its
 * wording has been revised repeatedly while the typed fields stayed stable —
 * grading wording would be grading a constant. These are the things that vary.
 */
export function resolutionSignal(res: ResolutionState | null): Signal {
  const base = {
    id: "resolution" as const,
    label: "Resolution",
    basis:
      "Oracle binding, supersession, void state and settlement-window lapse, measured from `expiry + settlementWindow` " +
      "(the instant `voidExpired()` becomes callable) rather than from expiry. Question wording is templated and identical " +
      "across markets, and the docs warn against parsing it, so it carries no signal.",
  };

  if (!res) {
    return {
      ...base,
      severity: "unknown",
      finding: "Oracle binding could not be read.",
      evidence: {},
    };
  }

  const evidence = {
    oracleQuestionId: res.oracleQuestionId,
    supersededBy: res.supersededByQuestionId,
    oracleVoided: res.oracleVoided,
    reuseCount: res.reuseCount,
    pastExpirySec: res.pastExpirySec,
    settlementWindowSec: res.settlementWindowSec,
    lapsedSec: res.lapsedSec,
    auditUrl: res.oracleExplorerUrl,
  };

  if (!res.oracleQuestionId) {
    return {
      ...base,
      severity: "severe",
      finding: "No oracle question is bound to this market, so nothing can resolve it.",
      evidence,
    };
  }
  if (res.oracleVoided) {
    return {
      ...base,
      severity: "severe",
      finding: "The oracle voided this question, so both sides redeem at 0.5 regardless of price.",
      evidence,
    };
  }
  if (res.supersededByQuestionId) {
    return {
      ...base,
      severity: "severe",
      finding: `The oracle question behind this market was superseded by question ${res.supersededByQuestionId}.`,
      evidence,
    };
  }

  // THREE DISTINCT STATES, not one escalating number. The old code measured the
  // lapse from `expiry` and described it in the conditional future ("if the
  // settlement window lapses anyone can void it"), which understates the case
  // that matters: on the stuck market we captured, the window had lapsed FOUR
  // DAYS earlier and `voidExpired()` was callable at that moment, by anyone.
  if (res.lapsedSec !== null) {
    return {
      ...base,
      severity: "severe",
      finding:
        `The settlement window closed ${humanDuration(res.lapsedSec)} ago with no oracle answer posted. ` +
        `\`voidExpired()\` is callable by anyone right now, which redeems both sides at 0.5 whatever the price says.`,
      evidence,
    };
  }
  if (res.pastExpirySec !== null) {
    // Late, not voidable. The oracle still holds the window, so settlement is
    // still the expected outcome — grading this severe would BLOCK every market
    // in the seconds after it locks.
    const window =
      res.settlementWindowSec === null
        ? "the settlement window length could not be read"
        : `${humanDuration(res.settlementWindowSec)} of settlement window`;
    return {
      ...base,
      severity: "elevated",
      finding: `Expired ${humanDuration(res.pastExpirySec)} ago with no answer posted yet, inside ${window}.`,
      evidence,
    };
  }
  return {
    ...base,
    severity: "ok",
    finding: `Bound to oracle question ${res.oracleQuestionId}, not voided or superseded; settlement is publicly auditable.`,
    evidence,
  };
}

/**
 * Venue: is this a real market or test scaffolding?
 *
 * Cheap and decisive. Two venues carry live binary markets on testnet; one runs
 * zero-volume "Pricefeed test" series with a numeric strike. Grading those as
 * though they were tradable would be the most embarrassing possible failure.
 */
export function venueSignal(venueId: string | null, question: string | null): Signal {
  const base = {
    id: "venue" as const,
    label: "Venue",
    basis:
      "Six venues carry binary rows on testnet; only one hosts real DreamDEX event contracts. The others include a " +
      "zero-volume pricefeed-test series.",
  };
  const evidence = { venueId, expected: DREAMDEX_VENUE_ID, question };

  if (!venueId) {
    return { ...base, severity: "unknown", finding: "Market carries no venue id.", evidence };
  }
  if (venueId.toLowerCase() !== DREAMDEX_VENUE_ID.toLowerCase()) {
    return {
      ...base,
      severity: "severe",
      finding: "This market is not on the DreamDEX event-contracts venue; it is test scaffolding on another venue.",
      evidence,
    };
  }
  return {
    ...base,
    severity: "ok",
    finding: "On the DreamDEX event-contracts venue.",
    evidence,
  };
}

/** Why the verdict came out the way it did — one rule, named. */
export interface RuleHit {
  rule: string;
  because: string;
}

export interface Assessment {
  verdict: Verdict;
  /**
   * Confidence in the VERDICT, not in any price prediction. It is a measure of
   * how completely we could observe the market: full data and a clear picture
   * scores high, half-degraded reads score low. It never expresses a view on
   * whether the market resolves YES.
   */
  confidence: number;
  signals: Signal[];
  /** The rules that actually fired, in the order the machine evaluated them. */
  rules: RuleHit[];
  /** Concrete things a user should confirm before acting. Empty on ALLOW. */
  requiredChecks: string[];
  action: "may_execute" | "do_not_execute";
  counts: Record<Severity, number>;
  /** Signals we could not measure — the reason confidence is capped. */
  unknownSignals: SignalId[];
}

/**
 * The verdict state machine. A PURE FUNCTION of the signals.
 *
 * This is the product's central claim: the score is computed, and the model only
 * explains it. So no LLM output feeds into this, the mapping is total and
 * deterministic, and the same snapshot always yields the same verdict.
 *
 * Rule order matters and is deliberate:
 *
 *   1. Wrong venue           → BLOCK  (it is not a real market)
 *   2. Cannot settle         → BLOCK  (nothing else matters if it can't resolve)
 *   3. Any severe signal     → BLOCK
 *   4. ANY unmeasured signal → RECHECK (never ALLOW on incomplete evidence)
 *   5. Any elevated signal   → RECHECK
 *   6. Otherwise             → ALLOW
 *
 * Rule 4 is the one that keeps this honest, and it is strict on purpose: a SINGLE
 * unmeasured signal is enough to withhold ALLOW. The gate caught an earlier,
 * laxer version of this rule handing out ALLOW to a market whose volatility and
 * order flow were both unmeasured — a clean bill of health issued over two blind
 * spots. Silence is not safety, and `ALLOW` means `may_execute`, so it has to mean
 * we actually looked at everything.
 *
 * The cost is that markets with fewer than three price buckets cannot reach ALLOW.
 * That is the correct trade: it makes ALLOW mean something, and RECHECK legible —
 * "we could not measure X" is a real, actionable reason rather than a hedge.
 */
export function assess(signals: Signal[]): Assessment {
  const counts: Record<Severity, number> = { ok: 0, elevated: 0, severe: 0, unknown: 0 };
  for (const s of signals) counts[s.severity]++;

  const by = (id: SignalId) => signals.find((s) => s.id === id);
  const severe = signals.filter((s) => s.severity === "severe");
  const elevated = signals.filter((s) => s.severity === "elevated");
  const unknown = signals.filter((s) => s.severity === "unknown");
  const unknownSignals = unknown.map((s) => s.id);

  const rules: RuleHit[] = [];
  const requiredChecks: string[] = [];
  let verdict: Verdict = "ALLOW";

  const venue = by("venue");
  const resolution = by("resolution");

  if (venue?.severity === "severe") {
    verdict = "BLOCK";
    rules.push({ rule: "wrong-venue", because: venue.finding });
  } else if (resolution?.severity === "severe") {
    verdict = "BLOCK";
    rules.push({ rule: "cannot-settle", because: resolution.finding });
  } else if (severe.length > 0) {
    verdict = "BLOCK";
    for (const s of severe) rules.push({ rule: `severe:${s.id}`, because: s.finding });
  } else {
    // The book is the one signal whose absence is disqualifying on its own —
    // without it there is no tradability to speak of.
    const bookUnknown = unknown.some((s) => s.id === "liquidity");
    if (bookUnknown) {
      verdict = "RECHECK";
      rules.push({
        rule: "unobservable-liquidity",
        because: "The order book could not be read, so tradability is unknown rather than acceptable.",
      });
      requiredChecks.push("Re-read the order book and confirm both sides are quoted");
    } else if (unknown.length > 0) {
      // Strict by design: one blind spot is enough to withhold ALLOW, because
      // ALLOW means may_execute. Names the specific gaps so RECHECK stays legible.
      verdict = "RECHECK";
      rules.push({
        rule: "incomplete-observation",
        because: `${unknown.length} signal${unknown.length === 1 ? "" : "s"} could not be measured (${unknownSignals.join(", ")}), so this cannot be cleared for execution.`,
      });
      for (const s of unknown) {
        requiredChecks.push(
          s.id === "volatility"
            ? "Wait for more trades to establish a price history before treating the move as known"
            : s.id === "manipulation"
              ? "Wait for more fills before reading flow direction"
              : s.id === "depth"
                ? "Read the resting book per order on-chain before trusting the displayed size"
                : `Establish ${s.label.toLowerCase()} before acting`,
        );
      }
      // Elevated findings still belong in the trace even when an unknown drove the
      // verdict — they are part of why a user should look closer.
      for (const s of elevated) rules.push({ rule: `elevated:${s.id}`, because: s.finding });
    } else if (elevated.length > 0) {
      verdict = "RECHECK";
      for (const s of elevated) rules.push({ rule: `elevated:${s.id}`, because: s.finding });
    } else {
      rules.push({
        rule: "all-clear",
        because: `All ${counts.ok} signals measured and within this venue's normal range.`,
      });
    }
  }

  // Checks are specific to what actually fired — a generic "do more research" line
  // is filler, and filler is what makes a verdict feel machine-made.
  for (const s of [...severe, ...elevated]) {
    switch (s.id) {
      case "liquidity":
        requiredChecks.push("Confirm you can exit at a price close to entry before sizing a position");
        break;
      case "depth":
        requiredChecks.push(
          "Re-read the book immediately before acting: the displayed depth expires in seconds and is not a commitment",
        );
        break;
      case "volatility":
        requiredChecks.push("Wait for the next few trades to see whether the move holds or reverts");
        break;
      case "staleness":
        requiredChecks.push("Treat the quoted mid as indicative until a fresh trade prints");
        break;
      case "window":
        requiredChecks.push("Re-check on-chain status immediately before acting; the window may lock first");
        break;
      case "manipulation":
        requiredChecks.push("Check whether one-sided flow is a single participant before following it");
        break;
      case "resolution":
        requiredChecks.push("Open the oracle audit page and confirm the settlement source");
        break;
      case "venue":
        requiredChecks.push("Switch to a market on the DreamDEX event-contracts venue");
        break;
    }
  }

  // Confidence = observational completeness, deliberately NOT a probability of
  // being right about the outcome. Unknowns dominate it because they are the only
  // thing that makes a verdict less trustworthy rather than merely less rosy.
  const measured = signals.length - unknown.length;
  const coverage = signals.length > 0 ? measured / signals.length : 0;
  // A verdict driven by unambiguous evidence is more certain than one balanced on
  // a single marginal reading.
  const decisiveness =
    verdict === "BLOCK"
      ? severe.length >= 2
        ? 1
        : 0.85
      : verdict === "ALLOW"
        ? counts.ok >= 5
          ? 0.95
          : 0.8
        : elevated.length >= 2
          ? 0.8
          : 0.7;
  const confidence = Number(Math.max(0.15, Math.min(0.98, coverage * decisiveness)).toFixed(2));

  return {
    verdict,
    confidence,
    signals,
    rules,
    requiredChecks: [...new Set(requiredChecks)],
    action: verdict === "ALLOW" ? "may_execute" : "do_not_execute",
    counts,
    unknownSignals,
  };
}

/**
 * Grade one snapshot. The only entry point Stages 3-5 should call.
 *
 * Refuses outright when on-chain state is missing: every other number describes a
 * market that might already have locked, and a verdict computed from that is
 * worse than no verdict.
 */
export function gradeSnapshot(s: MarketSnapshot): Assessment {
  const book = s.book.value;
  const onchain = s.onchain.value;

  const signals: Signal[] = [
    venueSignal(s.identity.venueId, s.identity.question),
    resolutionSignal(s.resolution.value),
    liquiditySignal(book, s.depth.value),
    depthSignal(s.depth.value),
    volatilitySignal(s.move.value),
    stalenessSignal(s.freshness.value, s.identity.intervalSec),
    windowSignal(s.freshness.value, s.identity.intervalSec),
    manipulationSignal(s.flow.value, book),
  ];

  // On-chain status is authoritative and gates everything. A market the chain says
  // is Locked or Resolved is not gradeable on its book at all.
  if (!onchain) {
    const assessment = assess(signals);
    return {
      ...assessment,
      verdict: "RECHECK",
      action: "do_not_execute",
      confidence: Math.min(assessment.confidence, 0.3),
      rules: [
        {
          rule: "no-onchain-state",
          because:
            "On-chain market status could not be read, so nothing here can be confirmed tradable. The indexer alone is not authoritative.",
        },
        ...assessment.rules,
      ],
      requiredChecks: [
        "Re-read on-chain market status before any action",
        ...assessment.requiredChecks,
      ],
    };
  }

  if (!onchain.tradable) {
    const assessment = assess(signals);
    const detail = onchain.isVoided
      ? "It was voided, so both sides redeem at 0.5."
      : onchain.isResolved
        ? `It resolved to ${onchain.winningOutcome === 0 ? "YES" : "NO"}; payouts are claimed by redeeming, not traded.`
        : "Only a market in Trading accepts orders.";
    // Drop the generic checks: advice about sizing a position or waiting for fills
    // is nonsense on a market that cannot be traded at all, and filler in a trace
    // is what makes it read as machine-generated.
    const checks = onchain.isResolved
      ? ["Redeem any winning position rather than attempting to trade"]
      : onchain.isVoided
        ? ["Redeem both outcome legs at 0.5 each"]
        : ["Wait for the next window in this series to open"];
    return {
      ...assessment,
      verdict: "BLOCK",
      action: "do_not_execute",
      requiredChecks: checks,
      rules: [
        {
          rule: "not-trading",
          because: `On-chain status is ${onchain.statusName}, not Trading. ${detail}`,
        },
        ...assessment.rules,
      ],
    };
  }

  return assess(signals);
}
