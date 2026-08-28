/**
 * Price history and trade flow, derived from candles and fills.
 *
 * Two things shape everything here, both measured on the live venue rather than
 * assumed:
 *
 * 1. CANDLES ARE SPARSE AND EVENT-DRIVEN. They are emitted per trade, not per
 *    interval. The BTC 24h market had six 60s candles at 08:25, 08:24, 07:00,
 *    06:57, 03:38 and 23:32 — gaps of hours — and every single one had
 *    `open == high == low == close`, because a bucket usually contains one price.
 *    Never interpolate and never draw a smooth curve: a continuous line through
 *    these points is invented data. Intra-candle range is therefore useless as a
 *    volatility measure; use the move BETWEEN candles.
 *
 * 2. STALENESS IS THE DOMINANT RISK DIMENSION HERE. The most recent fill on the
 *    deepest, most-traded market on the board was 214 MINUTES old. A naive "stale
 *    if no trade in 5 minutes" threshold grades every market stale, and a verdict
 *    that fires on everything communicates nothing. So staleness is always
 *    expressed RELATIVE to the window: 214 minutes into a 24h window is ~15%
 *    elapsed and unremarkable; the same age in a 4h window means it is nearly
 *    over.
 */

import type { CandleRow, FillRow } from "./queries.js";

/** A candle in human units, oldest-first ordering applied by the caller. */
export interface PricePoint {
  /** Bucket start, seconds. */
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Shares traded in the bucket. */
  volume: number;
  trades: number;
}

/**
 * Convert raw candle rows to human units, oldest first.
 *
 * `decimals` is the COLLATERAL's — 6 on testnet (tUSDC), 18 on mainnet (USDso).
 * Never hardcode it: the same code reading the wrong scale silently reports
 * prices off by 10^12.
 */
export function toPricePoints(rows: CandleRow[], decimals: number): PricePoint[] {
  const one = 10 ** decimals;
  return rows
    .map((r) => ({
      t: Number(r.bucketStart),
      open: Number(r.openPrice) / one,
      high: Number(r.high) / one,
      low: Number(r.low) / one,
      close: Number(r.closePrice) / one,
      volume: Number(r.baseVolume) / one,
      trades: Number(r.tradeCount),
    }))
    .sort((a, b) => a.t - b.t);
}

export interface MoveMetrics {
  /**
   * Largest absolute change in close price between CONSECUTIVE candles within the
   * lookback, in probability points. Between-candle rather than intra-candle
   * because these buckets have no intra-candle range to speak of.
   */
  maxStep?: number;
  /** Net change from the first to the last close in the window. */
  netChange?: number;
  /** Total shares traded across the window. */
  volume: number;
  /** Candles actually present — the honest sample size, often very small. */
  samples: number;
  /** Seconds spanned by those candles, first to last. */
  spanSec: number;
  /**
   * True when there is too little history to say anything. With 4–6 candles per
   * market being typical, this fires often and must be surfaced rather than
   * papered over with a confident-looking zero.
   */
  insufficient: boolean;
}

/** Minimum candles before a move metric means anything. */
export const MIN_SAMPLES_FOR_MOVE = 3;

export function moveMetrics(points: PricePoint[], lookbackSec?: number): MoveMetrics {
  const cutoff = lookbackSec ? Math.floor(Date.now() / 1000) - lookbackSec : 0;
  const window = points.filter((p) => p.t >= cutoff);

  const volume = window.reduce((a, p) => a + p.volume, 0);
  const samples = window.length;
  const first = window[0];
  const last = window[samples - 1];
  const spanSec = first && last ? last.t - first.t : 0;

  if (samples < MIN_SAMPLES_FOR_MOVE) {
    return { volume, samples, spanSec, insufficient: true };
  }

  let maxStep = 0;
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    const cur = window[i];
    if (!prev || !cur) continue;
    maxStep = Math.max(maxStep, Math.abs(cur.close - prev.close));
  }

  return {
    maxStep,
    netChange: last && first ? last.close - first.close : undefined,
    volume,
    samples,
    spanSec,
    insufficient: false,
  };
}

export interface FlowMetrics {
  /** Fills considered. */
  count: number;
  /** Shares bought by the taker (aggressive YES buying). */
  takerBuyShares: number;
  /** Shares sold by the taker (aggressive YES selling). */
  takerSellShares: number;
  /**
   * One-sidedness of aggressive flow in [-1, 1]. Positive = taker-buy dominated.
   * Measured on BTC 24h: the last eight fills were ALL `BUY_YES` takers walking
   * 0.253 → 0.246, which scores +1 — genuine one-sided pressure.
   */
  skew?: number;
  /** Shares that arrived via the mint-a-pair path (two buyers, no seller). */
  mintedShares: number;
  /** Seconds since the most recent fill. Undefined when there are none. */
  ageSec?: number;
  /** Volume-weighted average fill price across the sample. */
  vwap?: number;
}

/**
 * Aggregate trade flow.
 *
 * `takerSide` is one of `BUY_YES | SELL_YES | BUY_NO | SELL_NO`. A `BUY_NO` is
 * economically a YES sell, so the two are folded together — otherwise a market
 * traded entirely through the NO leg reads as having no flow at all.
 */
export function flowMetrics(rows: FillRow[], decimals: number, nowSec?: number): FlowMetrics {
  const one = 10 ** decimals;
  const now = nowSec ?? Math.floor(Date.now() / 1000);

  let takerBuyShares = 0;
  let takerSellShares = 0;
  let mintedShares = 0;
  let notional = 0;
  let shares = 0;
  let latest = 0;

  for (const r of rows) {
    const qty = Number(r.quantity) / one;
    const price = Number(r.fillPrice) / one;
    shares += qty;
    notional += qty * price;
    latest = Math.max(latest, Number(r.timestamp));

    // A NO buy is a YES sell in disguise; fold rather than drop.
    const side = r.takerSide ?? "";
    if (side === "BUY_YES" || side === "SELL_NO") takerBuyShares += qty;
    else if (side === "SELL_YES" || side === "BUY_NO") takerSellShares += qty;

    // The distinctive EC path: two opposite-side BUYERS cross with no seller and
    // the pool mints a fresh Up/Down pair from their combined collateral.
    if (r.kind && r.kind !== "DIRECT_YES" && r.kind !== "DIRECT_NO") mintedShares += qty;
  }

  const aggressive = takerBuyShares + takerSellShares;
  return {
    count: rows.length,
    takerBuyShares,
    takerSellShares,
    skew: aggressive > 0 ? (takerBuyShares - takerSellShares) / aggressive : undefined,
    mintedShares,
    ageSec: latest > 0 ? now - latest : undefined,
    vwap: shares > 0 ? notional / shares : undefined,
  };
}

export interface Freshness {
  /** Seconds since the last trade, or undefined if the market never traded. */
  lastTradeAgeSec?: number;
  /**
   * That age as a fraction of the market's own window length. THIS is the
   * comparable measure across a venue running 15m through 24h series — a raw
   * seconds figure is meaningless without the window it sits in.
   */
  ageVsWindow?: number;
  /** Fraction of the trading window already elapsed, in [0, 1]. */
  windowElapsed?: number;
  /** Seconds until expiry. Negative once past it. */
  secToExpiry: number;
  /** True when the market has never traded at all. */
  neverTraded: boolean;
}

export function freshness(args: {
  lastTradeAtSec?: number;
  tradingStartSec?: number;
  expirySec: number;
  intervalSec?: number;
  nowSec?: number;
}): Freshness {
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  const secToExpiry = args.expirySec - now;
  const windowLen =
    args.intervalSec ??
    (args.tradingStartSec ? args.expirySec - args.tradingStartSec : undefined);

  const lastTradeAgeSec =
    args.lastTradeAtSec && args.lastTradeAtSec > 0 ? now - args.lastTradeAtSec : undefined;

  const windowElapsed =
    windowLen && windowLen > 0 && args.tradingStartSec
      ? Math.min(1, Math.max(0, (now - args.tradingStartSec) / windowLen))
      : undefined;

  return {
    lastTradeAgeSec,
    ageVsWindow:
      lastTradeAgeSec !== undefined && windowLen && windowLen > 0
        ? lastTradeAgeSec / windowLen
        : undefined,
    windowElapsed,
    secToExpiry,
    neverTraded: lastTradeAgeSec === undefined,
  };
}
