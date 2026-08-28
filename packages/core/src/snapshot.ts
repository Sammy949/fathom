/**
 * `MarketSnapshot` — the single normalized type everything downstream reads.
 *
 * This is the contract between Stage 2 (ingestion) and Stages 3–5 (dashboard,
 * risk engine, agent). Nothing past this layer touches the indexer, the SDK or
 * the chain directly, which means every number in a verdict is traceable to a
 * field here.
 *
 * TWO DESIGN RULES, both learned the hard way in Stage 1:
 *
 * 1. EVERY FIELD CARRIES ITS PROVENANCE. A book read from the chain and a book
 *    that failed to load are not the same thing, and neither is "this market has
 *    no bids". The risk engine must be able to distinguish "measured and bad"
 *    from "could not measure" — the first is evidence for BLOCK, the second is a
 *    reason to withhold a verdict entirely. Conflating them is how an outage
 *    turns into a confident wrong answer.
 *
 * 2. KEYED BY `marketId`, NEVER BY POOL. Pools are recycled across windows.
 *    Measured: 133 sixty-second candles on the BTC 24h pool, of which 5 belong to
 *    the current market. Pool-keyed state silently mixes generations.
 */

import type { BookMetrics } from "./book.js";
import type { FlowMetrics, Freshness, MoveMetrics, PricePoint } from "./history.js";
import type { MarketRow, OracleQuestionRow } from "./queries.js";

/** On-chain market status. Only `Trading` accepts orders; `Locked` allows cancels. */
export const MARKET_STATUS = {
  Listed: 0,
  Trading: 1,
  Locked: 2,
  Settling: 3,
  Resolved: 4,
  Voided: 5,
} as const;

export type MarketStatusName = keyof typeof MARKET_STATUS;

export function statusName(status: number): MarketStatusName | "Unknown" {
  const hit = (Object.keys(MARKET_STATUS) as MarketStatusName[]).find(
    (k) => MARKET_STATUS[k] === status,
  );
  return hit ?? "Unknown";
}

/**
 * Why a piece of the snapshot is missing, when it is.
 *
 * `degraded` is the important one: it means the source was unreachable, NOT that
 * the answer is zero. Anything computing risk must treat it as unknown.
 */
export type Provenance =
  | { state: "ok"; readAt: number }
  | { state: "degraded"; readAt: number; reason: string }
  | { state: "absent"; readAt: number; reason: string };

export interface Sourced<T> {
  value: T | null;
  provenance: Provenance;
}

export const ok = <T>(value: T, readAt = Date.now()): Sourced<T> => ({
  value,
  provenance: { state: "ok", readAt },
});

export const degraded = <T>(reason: string, readAt = Date.now()): Sourced<T> => ({
  value: null,
  provenance: { state: "degraded", readAt, reason },
});

export const absent = <T>(reason: string, readAt = Date.now()): Sourced<T> => ({
  value: null,
  provenance: { state: "absent", readAt, reason },
});

/** Identity and static parameters. Typed fields only — never parse the question. */
export interface MarketIdentity {
  /** bytes32, module-scoped counter. The ONLY safe key. */
  marketId: string;
  /** Venue this market belongs to. Venue ids move; always carry it. */
  venueId: string | null;
  operatorId: number | null;
  /** `BTC` | `ETH` — typed, stable, and what you should branch on. */
  asset: string | null;
  /** Window length in seconds: 60, 300, 900, 3600, 14400, 86400. */
  intervalSec: number | null;
  /**
   * Tradable symbol, e.g. `BTC-0-29AUG26/tUSDC` or
   * `BTC-0-28AUG26-1200-BDF1/tUSDC`. Format is undocumented:
   * `ASSET-STRIKE-DDMMMYY[-HHMM][-IDSUFFIX]/COLLATERAL`, where the id suffix is
   * the low bytes of `marketId`, appended when two windows share a wall-clock
   * expiry. Display only — do not parse it.
   */
  symbol: string;
  yesSymbol: string;
  noSymbol: string;
  /**
   * A pool address, valid only for THIS market's generation. Recorded for
   * debugging and never used as a key.
   */
  poolAddress: string | null;
  /** Distinguishes successive markets sharing a recycled pool. */
  nonce: string | null;
  collateral: string | null;
  collateralDecimals: number;
  tradingStartSec?: number;
  expirySec: number;
  /**
   * Always 0 on this venue: these settle against their own OPENING price rather
   * than a fixed level. Kept because the field exists and a future venue may use it.
   */
  strike: string | null;
  /** The templated question text. Display only. */
  question: string | null;
}

/** Authoritative on-chain state — the only thing safe to gate an action on. */
export interface OnchainState {
  status: number;
  statusName: MarketStatusName | "Unknown";
  /** True only when status is exactly `Trading`. */
  tradable: boolean;
  isResolved: boolean;
  isVoided: boolean;
  /** Meaningful only when `isResolved` — otherwise 0 reads as a false YES win. */
  winningOutcome: number;
  finalized: boolean;
  expirySec: number;
  backing: string;
}

/**
 * Resolution-risk inputs.
 *
 * NOT wording-based. Every market on this venue asks the same templated question,
 * and the docs are explicit that its wording has been revised repeatedly while
 * the typed fields stayed stable — grading wording would be grading a constant.
 * These are the things that actually vary per market.
 */
export interface ResolutionState {
  oracleQuestionId: string | null;
  /** Non-null is a real red flag: the question behind this market was replaced. */
  supersededByQuestionId: string | null;
  oracleVoided: boolean | null;
  oracleResolvedAtSec: number | null;
  /** Times this oracle question has been reused across markets. */
  reuseCount: number | null;
  /**
   * The public audit trail for this market's settlement — sources, their values,
   * the median, and how many had to agree. The strongest credibility move
   * available to the decision trace: a verdict that cites a link a judge can open.
   */
  oracleExplorerUrl: string | null;
  /**
   * Seconds past expiry with no oracle answer posted. Escalating resolution risk:
   * once the settlement window lapses, anyone may call `voidExpired()` and both
   * sides redeem at 0.5.
   */
  lapsedSec: number | null;
}

/**
 * Everything Stages 3–5 need about one market, at one instant.
 *
 * Sourced fields may be null. That is the point — a degraded read is a first-class
 * state, not an exception to handle at the edges.
 */
export interface MarketSnapshot {
  identity: MarketIdentity;
  /** Wall clock (ms) the snapshot was assembled. */
  assembledAt: number;
  onchain: Sourced<OnchainState>;
  book: Sourced<BookMetrics>;
  prices: Sourced<PricePoint[]>;
  move: Sourced<MoveMetrics>;
  flow: Sourced<FlowMetrics>;
  freshness: Sourced<Freshness>;
  resolution: Sourced<ResolutionState>;
  /** The raw indexed row, for display and debugging. */
  row: MarketRow;
}

/** Public oracle audit page for a settlement question. */
export function oracleExplorerUrl(oracleQuestionId: string | null | undefined): string | null {
  if (!oracleQuestionId) return null;
  return `https://prd.oracle.somnia.host/questions/${oracleQuestionId}?view=graph`;
}

/** Resolution inputs assembled from the market row plus its oracle question. */
export function resolutionState(
  row: MarketRow,
  oracle: OracleQuestionRow | null,
  nowSec = Math.floor(Date.now() / 1000),
): ResolutionState {
  const expiry = Number(row.expiry ?? 0);
  const resolvedAt = oracle?.resolvedAt ? Number(oracle.resolvedAt) : null;
  const pastExpiry = expiry > 0 && nowSec > expiry;

  return {
    oracleQuestionId: row.oracleQuestionId,
    supersededByQuestionId: oracle?.supersededByQuestionId ?? null,
    oracleVoided: oracle?.voided ?? null,
    oracleResolvedAtSec: resolvedAt,
    reuseCount: oracle?.reuseCount ?? null,
    oracleExplorerUrl: oracleExplorerUrl(row.oracleQuestionId),
    // Only counts as lapsed while nothing has been posted. Once an answer lands,
    // the settlement window closed normally and there is no lapse risk left.
    lapsedSec: pastExpiry && !resolvedAt ? nowSec - expiry : null,
  };
}

/** True when enough of the snapshot loaded to grade it at all. */
export function isGradeable(s: MarketSnapshot): boolean {
  return s.onchain.provenance.state === "ok" && s.book.provenance.state === "ok";
}

/** Field names whose reads did not succeed — for the degraded-state UI. */
export function degradedFields(s: MarketSnapshot): string[] {
  const entries: [string, Provenance][] = [
    ["onchain", s.onchain.provenance],
    ["book", s.book.provenance],
    ["prices", s.prices.provenance],
    ["move", s.move.provenance],
    ["flow", s.flow.provenance],
    ["freshness", s.freshness.provenance],
    ["resolution", s.resolution.provenance],
  ];
  return entries.filter(([, p]) => p.state === "degraded").map(([name]) => name);
}
