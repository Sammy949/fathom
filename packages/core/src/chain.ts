/**
 * Direct chain reads, for the things the SDK's unified tier and the indexer both
 * flatten away.
 *
 * Three of them, and each one exists because an off-chain source is either wrong
 * or silent:
 *
 * 1. POOL PARAMS IN ONE CALL. `getBinaryPoolParams()` returns `market` and
 *    `collateralToken` together (plus outcome ids, backing and `marketNonce`).
 *    Do NOT chain pool -> market -> collateral(): that is two extra round-trips
 *    for fields this call already carries, and the intermediate hop can straddle
 *    a pool recycle. Verified live 2026-09-02 on pool 0xFF52C100…: one call
 *    returned market 0x27f6DE3d…, collateral 0x70a86D88…, nonce 164.
 *
 * 2. MARKET STATE INCLUDING `settlementWindow()`. The indexer has no field for
 *    it, and it is the difference between "past expiry" and "voidable by anyone".
 *    `expiry + settlementWindow` is the instant `voidExpired()` becomes callable.
 *
 * 3. PER-ORDER RESTING DEPTH WITH `owner` AND `expireTimestampNs`.
 *    `getAllOpenOrdersOffChain` is the only source for either. `getBookLevels`
 *    and the SDK's materialized book aggregate both fields out of existence, so
 *    a book that reads "990 shares a side, two-sided" off them can in fact be a
 *    single participant quoting against itself on a 20-second timer. Measured on
 *    this venue 2026-09-02: every one of 10 live markets had exactly ONE owner
 *    across both sides, with order TTLs of 11-28 seconds.
 *
 * `getAllOpenOrdersOffChain` REVERTS unless `msg.sender` is the zero address, so
 * these reads must never attach an account. viem's `readContract` omits `from`
 * by default; do not add one.
 */

import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";

import type { EcConfig } from "@fathom/ec";

export const binaryPoolAbi = parseAbi([
  "function getBinaryPoolParams() view returns ((address collateralToken, address market, address outcomeToken, uint256 yesId, uint256 noId, uint256 oneCollateral, uint256 setBacking, address feeRecipient, uint256 makerFeeBpsTimes1k, uint256 takerFeeBpsTimes1k, uint256 maxBuilderFeeBpsTimes1k, uint256 settlementFeeBpsTimes1k, address settlement, uint64 marketNonce, bool finalized))",
  "function getBookLevels(bool isBid, uint64 numLevels) view returns ((uint256 price, uint256 quantity)[])",
  "function getAllOpenOrdersOffChain(bool isBid, uint256 maxCount, uint64 startCursor) view returns ((uint128 orderId, bool isBid, address owner, uint64 userData, uint256 price, uint256 fullQuantity, uint256 quantityRemaining, uint64 expireTimestampNs)[] orders, bool hasMoreOrders, uint64 nextCursor)",
  "function booksEmpty() view returns (bool)",
  "function finalized() view returns (bool)",
  "function marketExpiryNs() view returns (uint64)",
]);

export const binaryMarketAbi = parseAbi([
  "function status() view returns (uint8)",
  "function isResolved() view returns (bool)",
  "function isVoided() view returns (bool)",
  "function payoutNumerators() view returns (uint256[])",
  "function expiry() view returns (uint64)",
  "function settlementWindow() view returns (uint64)",
  "function backing() view returns (uint256)",
  "function pool() view returns (address)",
  "function collateral() view returns (address)",
]);

/** A read-only viem client on the configured RPC. Endpoint comes from `.env`. */
export function publicClient(config: EcConfig): PublicClient {
  return createPublicClient({ transport: http(config.rpcUrl) }) as PublicClient;
}

export interface PoolParams {
  collateralToken: Address;
  market: Address;
  outcomeToken: Address;
  yesId: bigint;
  noId: bigint;
  setBacking: bigint;
  marketNonce: bigint;
  finalized: boolean;
}

/** Market address + collateral + outcome ids + nonce, in ONE call. See note 1. */
export async function poolParams(client: PublicClient, pool: Address): Promise<PoolParams> {
  const p = await client.readContract({
    address: pool,
    abi: binaryPoolAbi,
    functionName: "getBinaryPoolParams",
  });
  return {
    collateralToken: p.collateralToken,
    market: p.market,
    outcomeToken: p.outcomeToken,
    yesId: p.yesId,
    noId: p.noId,
    setBacking: p.setBacking,
    marketNonce: BigInt(p.marketNonce),
    finalized: p.finalized,
  };
}

export interface MarketChainState {
  status: number;
  isResolved: boolean;
  isVoided: boolean;
  payoutNumerators: readonly bigint[];
  expirySec: number;
  settlementWindowSec: number;
  backing: bigint;
  /**
   * The instant anyone may call `voidExpired()`. `expiry` alone is NOT it — the
   * oracle still holds the settlement window after expiry, so a market inside
   * that window is late, not voidable.
   */
  voidableFromSec: number;
}

/** Full market state, including the `settlementWindow` the indexer omits. */
export async function marketChainState(
  client: PublicClient,
  market: Address,
): Promise<MarketChainState> {
  // Written out rather than looped over a name list: viem's return types are
  // keyed off the literal `functionName`, so a `string` variable erases them and
  // every field comes back `unknown`.
  const at = { address: market, abi: binaryMarketAbi } as const;
  const [status, isResolved, isVoided, payoutNumerators, expiry, settlementWindow, backing] =
    await Promise.all([
      client.readContract({ ...at, functionName: "status" }),
      client.readContract({ ...at, functionName: "isResolved" }),
      client.readContract({ ...at, functionName: "isVoided" }),
      client.readContract({ ...at, functionName: "payoutNumerators" }),
      client.readContract({ ...at, functionName: "expiry" }),
      client.readContract({ ...at, functionName: "settlementWindow" }),
      client.readContract({ ...at, functionName: "backing" }),
    ]);

  const expirySec = Number(expiry);
  const settlementWindowSec = Number(settlementWindow);
  return {
    status,
    isResolved,
    isVoided,
    payoutNumerators,
    expirySec,
    settlementWindowSec,
    backing,
    voidableFromSec: expirySec + settlementWindowSec,
  };
}

/** One resting order, as the pool reports it. Quantities are raw collateral units. */
export interface RestingOrder {
  orderId: bigint;
  isBid: boolean;
  owner: Address;
  price: bigint;
  fullQuantity: bigint;
  quantityRemaining: bigint;
  expireTimestampNs: bigint;
}

/**
 * Every resting order on one side, all pages.
 *
 * Pagination is the contract's and unbounded, so this drains it with a page cap
 * rather than looping forever on a pathological book. Pages are taken at
 * whatever head each lands on; for the aggregate measures here that is fine, but
 * pin a block if you ever need them mutually consistent.
 */
export async function restingOrders(
  client: PublicClient,
  pool: Address,
  isBid: boolean,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<RestingOrder[]> {
  const pageSize = BigInt(opts.pageSize ?? 200);
  const maxPages = opts.maxPages ?? 10;
  const out: RestingOrder[] = [];
  let cursor = 0n;

  for (let page = 0; page < maxPages; page++) {
    const [orders, hasMore, next] = await client.readContract({
      address: pool,
      abi: binaryPoolAbi,
      functionName: "getAllOpenOrdersOffChain",
      // No `account`: the pool rejects this view from anything but address(0).
      args: [isBid, pageSize, cursor],
    });
    for (const o of orders) {
      out.push({
        orderId: o.orderId,
        isBid: o.isBid,
        owner: o.owner,
        price: o.price,
        fullQuantity: o.fullQuantity,
        quantityRemaining: o.quantityRemaining,
        expireTimestampNs: BigInt(o.expireTimestampNs),
      });
    }
    if (!hasMore) break;
    cursor = BigInt(next);
  }
  return out;
}

/** Both sides at once. */
export async function restingBook(
  client: PublicClient,
  pool: Address,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<{ bids: RestingOrder[]; asks: RestingOrder[] }> {
  const [bids, asks] = await Promise.all([
    restingOrders(client, pool, true, opts),
    restingOrders(client, pool, false, opts),
  ]);
  return { bids, asks };
}
