/**
 * Assembles `MarketSnapshot`s — the one place that talks to the indexer, the SDK
 * and the chain at the same time.
 *
 * Ordering rule: the on-chain read is authoritative and everything else is
 * decoration. The indexer trails the chain by seconds, so a market it still shows
 * as live may already be Locked. We therefore resolve the on-chain snapshot ONCE
 * per market per pass and reuse it, rather than re-reading between steps and
 * straddling a status change or a pool recycle.
 *
 * Failure rule: one bad market must never take down the pass, and one bad FIELD
 * must never take down its market. Every read is individually wrapped and lands
 * as `ok` / `degraded` / `absent`. A dashboard showing five good markets and one
 * degraded row is correct behaviour; a blank page because the sixth timed out is not.
 */

import type { EcContext } from "@fathom/ec";
import { marketOnchain, outcomeSymbols } from "@fathom/ec";
import type { UnifiedMarket } from "@somnia-chain/markets-sdk";
import type { Address } from "viem";

import { bookMetrics, DEFAULT_NEAR_BAND } from "./book";
import { binaryMarketAbi, publicClient, restingBook } from "./chain";
import { depthMetrics, type DepthMetrics } from "./depth";
import { flowMetrics, freshness, moveMetrics, toPricePoints } from "./history";
import { candles, fills, liveMarkets, oracleQuestion, type MarketRow } from "./queries";
import { withRetry } from "./resilient";
import {
  absent,
  degraded,
  isGradeable,
  ok,
  resolutionState,
  statusName,
  type MarketSnapshot,
  type MarketIdentity,
  type OnchainState,
  type Sourced,
} from "./snapshot";

/** Reason text from an unknown thrown value, without leaking a stack into the UI. */
const reasonOf = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}` : String(e);

/** Run a read, converting any failure into a degraded field rather than a throw. */
async function sourced<T>(read: () => Promise<T>): Promise<Sourced<T>> {
  try {
    return ok(await read());
  } catch (e) {
    return degraded<T>(reasonOf(e));
  }
}

/**
 * Which candle interval to chart for a given window length.
 *
 * Matching the bucket to the window keeps the sample count usable. Candles are
 * emitted per trade, so a 24h market bucketed at 60s yields a handful of points
 * scattered across a day, while 3600s buckets group them into something legible.
 */
export function candleIntervalFor(windowSec: number | null): number {
  if (!windowSec) return 300;
  if (windowSec <= 300) return 60;
  if (windowSec <= 3_600) return 60;
  if (windowSec <= 14_400) return 300;
  return 3_600;
}

function identityOf(
  market: UnifiedMarket,
  row: MarketRow,
  decimals: number,
): MarketIdentity {
  const { yes, no } = outcomeSymbols(market);
  return {
    marketId: row.marketId,
    venueId: row.venueId,
    operatorId: row.operatorId,
    asset: row.asset,
    intervalSec: row.intervalSec ? Number(row.intervalSec) : null,
    symbol: market.symbol,
    yesSymbol: yes,
    noSymbol: no,
    poolAddress: row.poolAddress,
    nonce: row.nonce,
    collateral: row.collateral,
    collateralDecimals: decimals,
    tradingStartSec: row.tradingStart ? Number(row.tradingStart) : undefined,
    expirySec: Number(row.expiry ?? 0),
    strike: row.strike,
    question: row.question,
  };
}

function onchainStateOf(
  oc: Awaited<ReturnType<typeof marketOnchain>>,
  settlementWindowSec: number | null,
): OnchainState {
  if (!oc) throw new Error("market is not binary, or has no on-chain snapshot");
  return {
    status: oc.status,
    statusName: statusName(oc.status),
    tradable: oc.status === 1,
    isResolved: oc.isResolved,
    isVoided: oc.isVoided,
    winningOutcome: oc.winningOutcome,
    finalized: oc.finalized,
    expirySec: Number(oc.expiry),
    backing: oc.backing.toString(),
    settlementWindowSec,
  };
}

export interface IngestOptions {
  /** Probability band counting as "near the touch". Defaults to the venue-calibrated 0.05. */
  nearBand?: number;
  /** Book depth to request per side. */
  bookDepth?: number;
  /** Fills to pull per market. */
  fillLimit?: number;
  /** Restrict to these marketIds (the demo set), in the order given. */
  onlyMarketIds?: string[];
  /** Drop windows shorter than this — 60s/300s expire before anyone can read a verdict. */
  minIntervalSec?: number;
}

/**
 * Build one snapshot, given an already-resolved indexed row and unified market.
 *
 * Takes the row rather than re-fetching it so a batch pass shares one market-list
 * read — and so every snapshot in a pass describes the same generation.
 */
export async function snapshotMarket(
  ctx: EcContext,
  market: UnifiedMarket,
  row: MarketRow,
  opts: IngestOptions = {},
): Promise<MarketSnapshot> {
  const assembledAt = Date.now();
  const nowSec = Math.floor(assembledAt / 1000);
  const { config } = ctx;
  const decimals = config.decimals;
  const identity = identityOf(market, row, decimals);

  // The authoritative read first. If it fails, downstream numbers may describe a
  // market that is no longer trading, so the snapshot is explicitly ungradeable.
  // Retried: `getMarketOnchain` goes through the SDK's own unretried transport.
  //
  // One extra `eth_call` rides along for `settlementWindow()`, which neither the
  // indexer nor `MarketOnchain` carries. Without it the engine can say a market
  // is past expiry but not whether `voidExpired()` is callable, and those are
  // different verdicts — so it is read rather than assumed. A failure here leaves
  // it null and the resolution signal degrades to "late" instead of "voidable".
  const onchain = await sourced(async () => {
    const oc = await withRetry(`getMarketOnchain(${identity.marketId.slice(-6)})`, () =>
      marketOnchain(ctx, market),
    );
    let settlementWindowSec: number | null = null;
    if (oc) {
      try {
        settlementWindowSec = Number(
          await withRetry(`settlementWindow(${identity.marketId.slice(-6)})`, () =>
            publicClient(config).readContract({
              address: oc.marketAddress,
              abi: binaryMarketAbi,
              functionName: "settlementWindow",
            }),
          ),
        );
      } catch {
        settlementWindowSec = null;
      }
    }
    return onchainStateOf(oc, settlementWindowSec);
  });

  // Book from the MATERIALIZED source. Never from indexer `Order` rows — measured
  // crossed at bid 0.320 / ask 0.270 on a market whose true book was 0.318/0.351.
  const book = await sourced(async () =>
    bookMetrics(
      await withRetry(`fetchOrderBook(${identity.yesSymbol})`, () =>
        ctx.exchange.fetchOrderBook(identity.yesSymbol, opts.bookDepth ?? 10),
      ),
      opts.nearBand ?? DEFAULT_NEAR_BAND,
    ),
  );

  // Per-order depth, from the chain. Independent of the materialized book above
  // on purpose: they come from different sources and fail separately, and the
  // engine has to distinguish "the book loaded but we could not see who owns it"
  // from "no book". Needs the pool address, which the indexed row carries for
  // THIS generation only — hence the nonce check in `identity`.
  const depth = await (async (): Promise<Sourced<DepthMetrics>> => {
    if (!row.poolAddress) return absent("indexed row carries no poolAddress");
    try {
      const client = publicClient(config);
      const resting = await withRetry(`restingBook(${identity.marketId.slice(-6)})`, () =>
        restingBook(client, row.poolAddress as Address),
      );
      return ok(await depthMetrics(client, resting, decimals, assembledAt));
    } catch (e) {
      return degraded<DepthMetrics>(reasonOf(e));
    }
  })();

  const interval = candleIntervalFor(identity.intervalSec);
  const priceRows = await sourced(() =>
    candles(config.indexerUrl, identity.marketId, interval),
  );
  const prices: Sourced<ReturnType<typeof toPricePoints>> =
    priceRows.value === null
      ? degraded(
          priceRows.provenance.state === "degraded" ? priceRows.provenance.reason : "unavailable",
        )
      : ok(toPricePoints(priceRows.value, decimals));

  const move =
    prices.value === null
      ? degraded<ReturnType<typeof moveMetrics>>("prices unavailable")
      : ok(moveMetrics(prices.value, identity.intervalSec ?? undefined));

  const fillRows = await sourced(() =>
    fills(config.indexerUrl, identity.marketId, opts.fillLimit ?? 100),
  );
  const flow: Sourced<ReturnType<typeof flowMetrics>> =
    fillRows.value === null
      ? degraded(
          fillRows.provenance.state === "degraded" ? fillRows.provenance.reason : "unavailable",
        )
      : ok(flowMetrics(fillRows.value, decimals, nowSec));

  // Prefer the newest fill's own timestamp over the row's `lastTradeAt`, which is
  // indexed and can trail it.
  const lastTradeAtSec =
    flow.value?.ageSec !== undefined
      ? nowSec - flow.value.ageSec
      : row.lastTradeAt
        ? Number(row.lastTradeAt)
        : undefined;

  const fresh = ok(
    freshness({
      lastTradeAtSec,
      tradingStartSec: identity.tradingStartSec,
      // On-chain expiry beats the indexed one when we have it.
      expirySec: onchain.value?.expirySec ?? identity.expirySec,
      intervalSec: identity.intervalSec ?? undefined,
      nowSec,
    }),
  );

  const resolution = await (async (): Promise<Sourced<ReturnType<typeof resolutionState>>> => {
    if (!row.oracleQuestionId) {
      return absent("market carries no oracleQuestionId");
    }
    // Returns null on a degraded read rather than throwing, so distinguish
    // "no oracle row" from "could not reach the indexer".
    const oracle = await oracleQuestion(config.indexerUrl, row.oracleQuestionId);
    return ok(resolutionState(row, oracle, nowSec, onchain.value?.settlementWindowSec ?? null));
  })();

  return { identity, assembledAt, onchain, book, depth, prices, move, flow, freshness: fresh, resolution, row };
}

export interface IngestResult {
  snapshots: MarketSnapshot[];
  /** Markets that were listed but could not be snapshotted at all. */
  failures: { marketId: string; symbol?: string; reason: string }[];
  venueId: string;
  assembledAt: number;
  /** True when at least one snapshot is gradeable — what the UI checks before scoring. */
  usable: boolean;
}

/**
 * Snapshot the venue's live markets.
 *
 * `loadMarkets(true)` is the SDK's registry sweep and the only place unified
 * `UnifiedMarket` objects (needed for symbols and the book) come from; the indexer
 * rows carry the typed fields. Joining them on `marketId` is what keeps the two
 * views describing the same generation — matching on symbol or pool would not.
 */
export async function ingestVenue(
  ctx: EcContext,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const assembledAt = Date.now();
  const nowSec = Math.floor(assembledAt / 1000);
  const { config } = ctx;
  const venueId = config.venueId;
  if (!venueId) {
    throw new Error(
      "VENUE_ID is not set. One deployment hosts several venues and their markets sit " +
        "side by side in the indexer, so there is no safe default. Read it off a live " +
        "market row (venue ids move).",
    );
  }

  const [rows, unified] = await Promise.all([
    liveMarkets(config.indexerUrl, venueId, nowSec),
    // `loadMarkets` is the SDK's registry sweep and runs through its OWN unretried
    // postGraphql. Left bare it was the single biggest source of failure: the gate
    // failed 3 runs in 5, every time inside listRegistryMarkets with ETIMEDOUT,
    // while our own wrapped queries alongside it succeeded.
    withRetry("loadMarkets", () => ctx.exchange.loadMarkets(true)),
  ]);

  const byId = new Map<string, UnifiedMarket>();
  for (const m of Object.values(unified)) {
    if (m.info.marketType === "BINARY") byId.set(String(m.info.marketId).toLowerCase(), m);
  }

  let selected = rows;
  if (opts.minIntervalSec) {
    const min = opts.minIntervalSec;
    selected = selected.filter((r) => Number(r.intervalSec ?? 0) >= min);
  }
  if (opts.onlyMarketIds?.length) {
    const want = opts.onlyMarketIds.map((id) => id.toLowerCase());
    selected = selected
      .filter((r) => want.includes(r.marketId.toLowerCase()))
      .sort((a, b) => want.indexOf(a.marketId.toLowerCase()) - want.indexOf(b.marketId.toLowerCase()));
  }

  const snapshots: MarketSnapshot[] = [];
  const failures: IngestResult["failures"] = [];

  const settled = await Promise.allSettled(
    selected.map(async (row) => {
      const market = byId.get(row.marketId.toLowerCase());
      if (!market) {
        // The registry sweep and the indexer disagree — usually a market that
        // rolled between the two reads.
        throw new Error(
          `no unified market for ${row.marketId} (registry/indexer disagree, likely rolled mid-read)`,
        );
      }
      return snapshotMarket(ctx, market, row, opts);
    }),
  );

  settled.forEach((r, i) => {
    const row = selected[i];
    if (r.status === "fulfilled") snapshots.push(r.value);
    else if (row) failures.push({ marketId: row.marketId, reason: reasonOf(r.reason) });
  });

  return {
    snapshots,
    failures,
    venueId,
    assembledAt,
    usable: snapshots.some(isGradeable),
  };
}
