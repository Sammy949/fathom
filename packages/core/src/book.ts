/**
 * Order-book metrics, computed from the SDK's MATERIALIZED book.
 *
 * The book must come from `exchange.fetchOrderBook`, which hydrates an indexer
 * snapshot and then replays chain logs on top. It must NOT come from the
 * indexer's `Order` rows.
 *
 * This is not a stylistic preference. Measured on 2026-08-28, seconds apart on
 * the same two markets:
 *
 *   ETH 24h  indexer rows: bid 0.320 / ask 0.270   ← crossed book, impossible
 *            materialized: bid 0.318 / ask 0.351   ← ground truth
 *   BTC 24h  indexer rows: bid 0.138 / ask 0.161
 *            materialized: bid 0.144 / ask 0.169
 *
 * The indexer's bid was roughly right while its ask was stale by 8 points. A risk
 * engine reading those rows computes a NEGATIVE spread and grades a healthy
 * market as manipulated — a confident, well-explained, completely wrong verdict.
 *
 * All prices here are YES probabilities in (0, 1). A NO price is `1 - yes`; the
 * SDK inverts automatically when you quote the NO symbol, so we always read the
 * YES book and derive.
 */

import type { UnifiedOrderBook } from "@somnia-chain/markets-sdk";

/** One side of the book, aggregated. */
export interface BookSide {
  /** Best price on this side, or undefined when the side is empty. */
  best?: number;
  /** Number of price levels present. */
  levels: number;
  /** Total shares resting across all levels. */
  depthShares: number;
  /**
   * Shares resting within `nearBand` of the best price on this side. Depth far
   * from the touch cannot be hit without moving the market, so it should not
   * count as executable liquidity.
   */
  nearShares: number;
  /** Collateral notional of `nearShares` (price x shares, summed per level). */
  nearNotional: number;
}

export interface BookMetrics {
  symbol: string;
  bid: BookSide;
  ask: BookSide;
  /** Midpoint of the touch. Undefined when either side is empty. */
  mid?: number;
  /** ask - bid, in probability points. Undefined when either side is empty. */
  spread?: number;
  /** Spread as a fraction of mid — the comparable measure across price levels. */
  spreadPct?: number;
  /**
   * Near-touch depth imbalance in [-1, 1]. Positive means the bid side is
   * heavier (buying pressure resting), negative means the ask side is.
   * `(bidNear - askNear) / (bidNear + askNear)`.
   */
  imbalance?: number;
  /**
   * True when the book is crossed (bid >= ask), which cannot happen on a real
   * matching engine. If this is ever true on a materialized book, the read is
   * broken — do NOT compute risk from it.
   */
  crossed: boolean;
  /** Set when the book is unusable, with the reason. */
  unusable?: "empty" | "one-sided" | "crossed";
  /** Local clock (ms) when the book view was assembled. */
  assembledAt: number;
  /** The band used for the near-touch aggregates, in probability points. */
  nearBand: number;
}

/**
 * How wide a band counts as "near the touch", in probability points.
 *
 * Calibrated to this venue, not to a real-money book. Observed spreads run
 * genuinely wide — BTC 15m sat 0.536/0.607, a 7-point spread on a 0.57 mid — with
 * ladder levels roughly 1 point apart. A tight band (say 0.01) would capture a
 * single level and report almost every market as having no depth.
 */
export const DEFAULT_NEAR_BAND = 0.05;

function summarize(
  levels: [number, number][],
  side: "bid" | "ask",
  nearBand: number,
): BookSide {
  if (levels.length === 0) return { levels: 0, depthShares: 0, nearShares: 0, nearNotional: 0 };

  // fetchOrderBook returns bids best-first (descending) and asks best-first
  // (ascending), but do not trust ordering — take the extreme explicitly.
  const prices = levels.map(([p]) => p);
  const best = side === "bid" ? Math.max(...prices) : Math.min(...prices);
  const limit = side === "bid" ? best - nearBand : best + nearBand;

  let depthShares = 0;
  let nearShares = 0;
  let nearNotional = 0;
  for (const [price, shares] of levels) {
    depthShares += shares;
    const inBand = side === "bid" ? price >= limit : price <= limit;
    if (inBand) {
      nearShares += shares;
      nearNotional += price * shares;
    }
  }
  return { best, levels: levels.length, depthShares, nearShares, nearNotional };
}

/**
 * Reduce a materialized book to the metrics the risk engine consumes.
 *
 * Deliberately returns a populated object with `unusable` set rather than
 * throwing: "this market has no book" is a legitimate, gradeable state (it is
 * strong evidence for BLOCK), not an error. Throwing here would let one empty
 * market take down a whole dashboard refresh.
 */
export function bookMetrics(
  book: UnifiedOrderBook,
  nearBand: number = DEFAULT_NEAR_BAND,
): BookMetrics {
  const bid = summarize(book.bids ?? [], "bid", nearBand);
  const ask = summarize(book.asks ?? [], "ask", nearBand);
  const assembledAt = book.timestamp ?? Date.now();

  const base: BookMetrics = {
    symbol: book.symbol,
    bid,
    ask,
    crossed: false,
    assembledAt,
    nearBand,
  };

  if (bid.best === undefined && ask.best === undefined) {
    return { ...base, unusable: "empty" };
  }
  if (bid.best === undefined || ask.best === undefined) {
    return { ...base, unusable: "one-sided" };
  }

  const crossed = bid.best >= ask.best;
  const mid = (bid.best + ask.best) / 2;
  const spread = ask.best - bid.best;
  const nearTotal = bid.nearShares + ask.nearShares;

  return {
    ...base,
    mid,
    spread,
    spreadPct: mid > 0 ? spread / mid : undefined,
    imbalance: nearTotal > 0 ? (bid.nearShares - ask.nearShares) / nearTotal : undefined,
    crossed,
    ...(crossed ? { unusable: "crossed" as const } : {}),
  };
}

/**
 * Shares executable within `maxSlippage` of the touch, walking the book.
 *
 * This is the honest answer to "could I actually get out of this position?",
 * which is the question the liquidity signal exists to ask. A buy walks the asks
 * upward; a sell walks the bids downward.
 */
export function executableShares(
  book: UnifiedOrderBook,
  side: "buy" | "sell",
  maxSlippage = DEFAULT_NEAR_BAND,
): number {
  const levels = side === "buy" ? (book.asks ?? []) : (book.bids ?? []);
  if (levels.length === 0) return 0;
  const prices = levels.map(([p]) => p);
  const best = side === "buy" ? Math.min(...prices) : Math.max(...prices);
  const limit = side === "buy" ? best + maxSlippage : best - maxSlippage;

  let shares = 0;
  for (const [price, size] of levels) {
    if (side === "buy" ? price <= limit : price >= limit) shares += size;
  }
  return shares;
}
