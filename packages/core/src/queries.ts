/**
 * The queries Fathom runs against the indexer, and the shapes they return.
 *
 * Every query here is written against the schema as it actually is, verified by
 * introspection on 2026-08-28. The docs get several field names wrong, and each
 * one cost a failed query:
 *
 *   Candle  → `bucketStart`, `openPrice`, `closePrice`, `intervalSeconds`,
 *             `baseVolume`, `quoteVolume`  (NOT timestamp/open/close/interval)
 *   Order   → `fullQuantity`, `quantityRemaining`, `filledQuantity`
 *             (there is no `quantity` field)
 *   Market  → `intervalSec` (not intervalSeconds — it differs from Candle's)
 *
 * There are also NO `_aggregate` queries exposed: `Candle_aggregate` does not
 * exist on `query_root`, so counting means fetching rows.
 *
 * TWO SCOPING RULES, both load-bearing:
 *
 * 1. Filter history by `market_id`, NEVER by `pool`. Pools are recycled across
 *    consecutive windows. Measured on the BTC 24h pool: 133 sixty-second candles
 *    exist on the pool, and only 5 belong to the current market — a ~27:1 ratio.
 *    A pool-scoped chart splices together dozens of unrelated expired windows.
 *
 * 2. Do not read the order book from `Order` rows. They lag the chain badly
 *    enough to be self-contradictory: measured ETH 24h at bid 0.320 / ask 0.270,
 *    a crossed book, which cannot exist. The book comes from the SDK's
 *    materialized `fetchOrderBook` (see book.ts).
 */

import { query, queryOrNull, type RetryPolicy } from "./indexer.js";

/** A binary market row, typed fields only — never parse the question text. */
export interface MarketRow {
  marketId: string;
  asset: string | null;
  intervalSec: string | null;
  strike: string | null;
  expiry: string | null;
  tradingStart: string | null;
  venueId: string | null;
  operatorId: number | null;
  poolAddress: string | null;
  nonce: string | null;
  yesTokenId: string | null;
  noTokenId: string | null;
  collateral: string | null;
  clobStatus: string | null;
  finalized: boolean | null;
  voided: boolean | null;
  winningOutcome: number | null;
  lastPrice: string | null;
  lastTradeAt: string | null;
  tradeCount: string | null;
  cumulativeQuoteVolume: string | null;
  oracleQuestionId: string | null;
  question: string | null;
}

const MARKET_FIELDS = `
  marketId asset intervalSec strike expiry tradingStart
  venueId operatorId poolAddress nonce
  yesTokenId noTokenId collateral clobStatus
  finalized voided winningOutcome
  lastPrice lastTradeAt tradeCount cumulativeQuoteVolume
  oracleQuestionId question
`;

/**
 * Live (unfinalized, unexpired) binary markets on one venue, soonest expiry
 * first.
 *
 * Scoped to a venue because one deployment hosts several and their markets sit
 * side by side in the indexer. Verified live: six venues carry binary rows on
 * testnet, and one of the two active ones serves zero-volume "Pricefeed test"
 * markets that would be nonsense to grade.
 */
export async function liveMarkets(
  endpoint: string,
  venueId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  policy?: RetryPolicy,
): Promise<MarketRow[]> {
  const gql = `
    query FathomLiveMarkets($venueId: String!, $now: numeric!) {
      Market(
        where: {
          marketType: { _eq: "BINARY" }
          venueId: { _eq: $venueId }
          finalized: { _eq: false }
          expiry: { _gt: $now }
        }
        order_by: { expiry: asc }
      ) { ${MARKET_FIELDS} }
    }`;
  const data = await query<{ Market: MarketRow[] }>(
    endpoint,
    "LiveMarkets",
    gql,
    { venueId, now: String(nowSec) },
    policy,
  );
  return data.Market;
}

/** One market by id — the authoritative indexed row for a known market. */
export async function marketById(
  endpoint: string,
  marketId: string,
  policy?: RetryPolicy,
): Promise<MarketRow | null> {
  const gql = `
    query FathomMarketById($marketId: String!) {
      Market(where: { marketId: { _eq: $marketId } }, limit: 1) { ${MARKET_FIELDS} }
    }`;
  const data = await query<{ Market: MarketRow[] }>(
    endpoint,
    "MarketById",
    gql,
    { marketId },
    policy,
  );
  return data.Market[0] ?? null;
}

/**
 * Every venue currently carrying live binary markets, with a sample market each.
 *
 * Venue ids move — both networks changed theirs three times in the first week of
 * August 2026 — so a hardcoded `VENUE_ID` can silently match nothing. This is how
 * we re-verify at session start and how the doctor explains an empty scope.
 */
export async function liveVenues(
  endpoint: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  policy?: RetryPolicy,
): Promise<{ venueId: string; operatorId: number | null; markets: number; sampleQuestion: string | null }[]> {
  const gql = `
    query FathomLiveVenues($now: numeric!) {
      Market(
        where: {
          marketType: { _eq: "BINARY" }
          finalized: { _eq: false }
          expiry: { _gt: $now }
        }
        order_by: { expiry: asc }
      ) { venueId operatorId question }
    }`;
  const data = await query<{
    Market: { venueId: string | null; operatorId: number | null; question: string | null }[];
  }>(endpoint, "LiveVenues", gql, { now: String(nowSec) }, policy);

  const byVenue = new Map<string, { operatorId: number | null; markets: number; sampleQuestion: string | null }>();
  for (const row of data.Market) {
    const key = (row.venueId ?? "unknown").toLowerCase();
    const existing = byVenue.get(key);
    if (existing) existing.markets += 1;
    else byVenue.set(key, { operatorId: row.operatorId, markets: 1, sampleQuestion: row.question });
  }
  return [...byVenue.entries()]
    .map(([venueId, v]) => ({ venueId, ...v }))
    .sort((a, b) => b.markets - a.markets);
}

/** An OHLC bucket. Sparse and event-driven — see `candles` below. */
export interface CandleRow {
  bucketStart: string;
  openPrice: string;
  high: string;
  low: string;
  closePrice: string;
  baseVolume: string;
  quoteVolume: string;
  tradeCount: string;
}

/**
 * Candles for ONE market, newest first.
 *
 * These are NOT a regular time series. They are emitted per trade, so buckets
 * only exist where trading happened. Measured on the BTC 24h market: six 60s
 * candles at 08:25, 08:24, 07:00, 06:57, 03:38, 23:32 — gaps of hours — and every
 * one had `open == high == low == close` because a bucket usually holds a single
 * price.
 *
 * So: never interpolate, and never draw a smooth line through them. A continuous
 * curve here is fabricated data. Plot the real points and let the gaps show.
 *
 * Valid `intervalSeconds`: 60, 300, 900, 3600, 14400, 86400.
 */
export async function candles(
  endpoint: string,
  marketId: string,
  intervalSeconds: number,
  limit = 200,
  policy?: RetryPolicy,
): Promise<CandleRow[]> {
  const gql = `
    query FathomCandles($marketId: String!, $iv: Int!, $limit: Int!) {
      Candle(
        where: { market_id: { _eq: $marketId }, intervalSeconds: { _eq: $iv } }
        order_by: { bucketStart: desc }
        limit: $limit
      ) { bucketStart openPrice high low closePrice baseVolume quoteVolume tradeCount }
    }`;
  const data = await query<{ Candle: CandleRow[] }>(
    endpoint,
    "Candles",
    gql,
    { marketId, iv: intervalSeconds, limit },
    policy,
  );
  return data.Candle;
}

/**
 * A trade. `kind` distinguishes the crossing path — `DIRECT_YES` is a normal
 * taker/maker match, and the mint-a-pair path appears when two opposite-side
 * BUYERS cross with no seller at all and the pool mints a fresh Up/Down pair.
 */
export interface FillRow {
  timestamp: string;
  fillPrice: string;
  quantity: string;
  quoteQuantity: string;
  takerIsBid: boolean | null;
  takerSide: string | null;
  makerSide: string | null;
  kind: string | null;
  blockNumber: string;
  logIndex: string;
  txHash: string;
}

/**
 * Recent fills for ONE market, newest first.
 *
 * This is the real microstructure input: `takerSide` gives flow direction,
 * `quantity` its size, `kind` the crossing path. Measured on BTC 24h, the last
 * eight fills were all `takerSide: BUY_YES`, `kind: DIRECT_YES`, walking the
 * price 0.253 → 0.246 — one-sided pressure, which is a genuine manipulation
 * input rather than a proxy for one.
 *
 * Also the staleness input, and staleness is the dominant risk dimension on this
 * venue: that same market's most recent fill was 214 minutes old, and it is the
 * most-traded market on the board. Calibrate against that, and always express
 * age relative to the window length — 214 minutes into a 24h window is ~15%
 * elapsed and unremarkable; into a 4h window it means the thing is nearly over.
 */
export async function fills(
  endpoint: string,
  marketId: string,
  limit = 100,
  policy?: RetryPolicy,
): Promise<FillRow[]> {
  const gql = `
    query FathomFills($marketId: String!, $limit: Int!) {
      Fill(
        where: { market_id: { _eq: $marketId } }
        order_by: { timestamp: desc }
        limit: $limit
      ) {
        timestamp fillPrice quantity quoteQuantity
        takerIsBid takerSide makerSide kind
        blockNumber logIndex txHash
      }
    }`;
  const data = await query<{ Fill: FillRow[] }>(
    endpoint,
    "Fills",
    gql,
    { marketId, limit },
    policy,
  );
  return data.Fill;
}

/**
 * The oracle question behind a market, and whether it has been superseded.
 *
 * This is the resolution-risk input that actually varies. The question TEXT does
 * not: every market on the live venue asks the same templated
 * "BTC closes at or above its opening price", and the docs are explicit that its
 * wording has been revised repeatedly while the typed fields stayed stable. So
 * grading wording would be grading a constant.
 *
 * `supersededByQuestionId` being non-null is a real red flag, and `voided` plus
 * `resolvedAt` tell us whether settlement actually landed or the window lapsed.
 * Returns null rather than throwing when the indexer is degraded — a missing
 * oracle row should show as unknown, not blank the whole verdict.
 */
export interface OracleQuestionRow {
  oracleQuestionId: string;
  questionKey: string | null;
  resolvedAt: string | null;
  voided: boolean | null;
  supersededByQuestionId: string | null;
  reuseCount: number | null;
  bindCount: number | null;
}

export async function oracleQuestion(
  endpoint: string,
  oracleQuestionId: string,
  policy?: RetryPolicy,
): Promise<OracleQuestionRow | null> {
  const gql = `
    query FathomOracleQuestion($id: numeric!) {
      OracleQuestion(where: { oracleQuestionId: { _eq: $id } }, limit: 1) {
        oracleQuestionId questionKey resolvedAt voided
        supersededByQuestionId reuseCount bindCount
      }
    }`;
  const data = await queryOrNull<{ OracleQuestion: OracleQuestionRow[] }>(
    endpoint,
    "OracleQuestion",
    gql,
    { id: oracleQuestionId },
    policy,
  );
  return data?.OracleQuestion[0] ?? null;
}
