/**
 * @license
 * Copyright DreamDEX S.A.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/LICENSE
 */

// The event-contract footguns, encoded as cheap assertions. Call these before
// sending an order so a mistake fails loudly + locally instead of reverting
// on-chain (or filling at a price you didn't mean).

import type { MarketOnchain } from "@somnia-chain/markets-sdk";
import { MARKET_STATUS } from "./markets.js";

/**
 * Prices are YES probabilities in (0,1) — NOT dollars, NOT 0-100. "buy YES at
 * 0.62" means 62% implied. Anything outside the open interval is almost always
 * a unit mistake (e.g. passing 62 instead of 0.62).
 */
export function assertProbability(p: number, label = "price"): void {
  if (!(p > 0 && p < 1)) {
    throw new Error(`${label} must be a YES probability in (0,1), got ${p}. Did you pass a percent (62) instead of 0.62?`);
  }
}

/**
 * Hold a computed price inside the open interval, for prices DERIVED from the
 * book rather than typed by you.
 *
 * Crossing a touch is the usual way out of bounds: sell one tick under a 0.002
 * bid and you have asked for 0, buy one over a 0.999 ask and you have asked for
 * 1 — both of which `assertProbability` rejects, killing a cycle over an
 * arithmetic edge rather than a mistake. Clamp derived prices; let a price you
 * configured yourself throw, because there the assertion is doing its job.
 */
export const clampProbability = (p: number, lo = 0.01, hi = 0.99): number =>
  Math.min(hi, Math.max(lo, p));

/** NO price is the complement of YES. Handy when you think in one and quote the other. */
export const noPrice = (yes: number): number => 1 - yes;

/**
 * Only `Trading` markets accept orders. A resolved market pays out via redeem,
 * not trades; locked/settling take nothing. Gate on the on-chain status, then
 * call this to fail with a reason.
 */
export function assertTradable(onchain: Pick<MarketOnchain, "status">): void {
  if (onchain.status !== MARKET_STATUS.Trading) {
    const name = Object.keys(MARKET_STATUS).find((k) => MARKET_STATUS[k as keyof typeof MARKET_STATUS] === onchain.status);
    throw new Error(
      `Market is '${name ?? onchain.status}', not 'Trading' — no orders accepted. ` +
        `(Resolved markets pay out via redeem; voided refund both sides at 0.5.)`,
    );
  }
}

/**
 * You can only SELL an outcome you hold — new tokens come from mint-a-pair, not
 * a naked short. Guard SELL orders on your ERC-6909 balance (raw units).
 */
export function assertInventoryForSell(side: "buy" | "sell", held: bigint, size: bigint, outcome: "YES" | "NO"): void {
  if (side === "sell" && held < size) {
    throw new Error(`Not enough ${outcome} tokens to sell (have ${held}, need ${size}). Mint a pair first.`);
  }
}

// Payout maths live in settlement.ts (`estimatePayout`), which uses the SDK's own
// fee-aware calculator. Don't hand-roll it: the winner redeems `1 − settlement
// fee`, not 1:1, and a voided market pays both sides 0.5 with no fee.
