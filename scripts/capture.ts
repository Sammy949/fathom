/**
 * Freeze one market's full evidence to a committed JSON fixture.
 *
 *   npm run capture -- <marketId> [label]
 *
 * WHY THIS EXISTS. The strongest BLOCK case Fathom has is a real market on our
 * own venue that is Locked on-chain, unresolved, four days past the instant
 * `voidExpired()` became callable, holding 1503 tUSDC — while the indexer still
 * reports `clobStatus: "Trading"`. That is not a category we assert; it is a
 * failure demonstrated on the venue, with a four-day-old indexer lie attached.
 *
 * It is also perishable. `voidExpired()` is PERMISSIONLESS: any keeper, any
 * bot, anyone at all can call it, and the moment someone does, `isVoided` flips,
 * the backing releases and the evidence is gone forever. So it gets captured to
 * disk and committed, not re-read at demo time.
 *
 * Ingestion cannot reach it either way: `liveMarkets` filters `expiry > now`
 * (queries.ts), which is correct for the dashboard and fatal here. This goes
 * through `marketById` instead.
 *
 * Everything time-derived is computed against the captured instant and stored
 * alongside it, so replaying the fixture reproduces the verdict exactly rather
 * than drifting as the wall clock moves.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createExchange, type EcContext } from "@fathom/ec";
import {
  binaryPoolAbi,
  bookMetrics,
  candleIntervalFor,
  candles,
  degraded,
  fills,
  flowMetrics,
  freshness,
  gradeSnapshot,
  marketById,
  marketChainState,
  ok,
  oracleQuestion,
  poolParams,
  publicClient,
  resolutionState,
  restingBook,
  statusName,
  toPricePoints,
  withRetry,
  type MarketRow,
  type MarketSnapshot,
} from "@fathom/core";
import type { Address } from "viem";

const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const RED = "\x1b[31m";

const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures");

/** BigInt is not JSON-serializable and silently throws; stringify it explicitly. */
const jsonSafe = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

function usage(): never {
  console.error(
    `usage: npm run capture -- <marketId> [label]\n\n` +
      `  marketId  bytes32, e.g. 0x…c067 (the id, not the pool address)\n` +
      `  label     output filename stem; defaults to the id's last 6 hex chars\n`,
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const marketId = process.argv[2];
  if (!marketId?.startsWith("0x")) usage();
  const label = process.argv[3] ?? marketId.slice(-6);

  const ctx: EcContext = createExchange({ withSigner: false });
  const { config } = ctx;
  const client = publicClient(config);

  const capturedAt = Date.now();
  const nowSec = Math.floor(capturedAt / 1000);

  console.log(`${BOLD}capture${R} ${marketId}  ${DIM}at ${new Date(capturedAt).toISOString()}${R}\n`);

  // ── the indexed row, and what it claims ──────────────────────────────────────
  const row: MarketRow | null = await withRetry("marketById", () =>
    marketById(config.indexerUrl, marketId),
  );
  if (!row) {
    console.error(`${RED}no indexed Market row for ${marketId}${R}`);
    process.exit(1);
  }
  if (!row.poolAddress) {
    console.error(`${RED}row carries no poolAddress; cannot read chain state${R}`);
    process.exit(1);
  }
  console.log(
    `  indexer   ${row.asset} ${row.intervalSec}s  clobStatus=${YEL}${row.clobStatus}${R} ` +
      `finalized=${row.finalized} voided=${row.voided} nonce=${row.nonce} oracleQ=${row.oracleQuestionId}`,
  );

  // ── the chain, which is authoritative ────────────────────────────────────────
  // ONE call for market + collateral. Not pool -> market -> collateral().
  const pool = row.poolAddress as Address;
  const params = await withRetry("getBinaryPoolParams", () => poolParams(client, pool));
  const chain = await withRetry("marketChainState", () => marketChainState(client, params.market));

  const lapsedPastVoidable = nowSec - chain.voidableFromSec;
  console.log(
    `  chain     status=${RED}${chain.status} (${statusName(chain.status)})${R} ` +
      `isResolved=${chain.isResolved} isVoided=${chain.isVoided} ` +
      `payouts=[${chain.payoutNumerators.join(",")}]`,
  );
  console.log(
    `            market=${params.market} collateral=${params.collateralToken} nonce=${params.marketNonce}`,
  );
  console.log(
    `            backing=${Number(chain.backing) / 10 ** config.decimals} ` +
      `expiry=${chain.expirySec} +window=${chain.settlementWindowSec}s ` +
      `voidable since ${DIM}${new Date(chain.voidableFromSec * 1000).toISOString()}${R}`,
  );

  if (chain.isVoided || chain.isResolved) {
    console.log(
      `\n${YEL}NOTE${R} this market is no longer unresolved — someone settled or voided it. ` +
        `Capturing anyway, but it is no longer the stuck-market case.`,
    );
  }
  console.log(
    lapsedPastVoidable > 0
      ? `  ${GRN}evidence intact${R}: voidable for ${(lapsedPastVoidable / 86_400).toFixed(2)}d ` +
          `(${lapsedPastVoidable}s) and still uncalled\n`
      : `  not yet voidable (${-lapsedPastVoidable}s of settlement window left)\n`,
  );

  // ── the resting book, per order, with owners ─────────────────────────────────
  // `booksEmpty()` and the order views have been observed to DISAGREE on this
  // pool: the flag says the books are not empty while both sides read []. The
  // disagreement is recorded, not resolved — we have not confirmed the cause.
  const resting = await withRetry("restingBook", () => restingBook(client, pool));
  const booksEmpty = await withRetry("booksEmpty", () =>
    client.readContract({
      address: pool,
      abi: binaryPoolAbi,
      functionName: "booksEmpty",
    }),
  );
  console.log(
    `  book      restingBids=${resting.bids.length} restingAsks=${resting.asks.length} ` +
      `booksEmpty()=${booksEmpty}${
        booksEmpty === false && resting.bids.length + resting.asks.length === 0
          ? `  ${YEL}(disagreement — flag says non-empty, order views say empty)${R}`
          : ""
      }`,
  );

  // ── the off-chain context the risk engine reads ──────────────────────────────
  const interval = candleIntervalFor(row.intervalSec ? Number(row.intervalSec) : null);
  const [candleRows, fillRows, oracle] = await Promise.all([
    withRetry("candles", () => candles(config.indexerUrl, marketId, interval)),
    withRetry("fills", () => fills(config.indexerUrl, marketId, 100)),
    withRetry("oracleQuestion", () =>
      row.oracleQuestionId
        ? oracleQuestion(config.indexerUrl, row.oracleQuestionId)
        : Promise.resolve(null),
    ),
  ]);

  // The materialized book needs a unified market, and the registry sweep may not
  // carry a locked one. Fall back to the pool's own levels rather than failing:
  // an empty book on a locked market is the honest reading either way.
  let book: MarketSnapshot["book"];
  try {
    const unified = Object.values(await withRetry("loadMarkets", () => ctx.exchange.loadMarkets(true)));
    const hit = unified.find(
      (m) => String(m.info.marketId).toLowerCase() === marketId.toLowerCase(),
    );
    if (!hit) throw new Error("market absent from the registry sweep (locked markets can be)");
    const yes = hit.outcomes?.[0]?.symbol ?? `${hit.symbol}#YES`;
    book = ok(bookMetrics(await withRetry("fetchOrderBook", () => ctx.exchange.fetchOrderBook(yes, 10))));
  } catch (e) {
    book = degraded((e as Error).message);
    console.log(`  ${DIM}materialized book unavailable: ${(e as Error).message}${R}`);
  }

  // ── assemble the snapshot exactly as ingestion would ─────────────────────────
  const prices = toPricePoints(candleRows, config.decimals);
  const flow = flowMetrics(fillRows, config.decimals, nowSec);
  const snapshot: MarketSnapshot = {
    identity: {
      marketId: row.marketId,
      venueId: row.venueId,
      operatorId: row.operatorId,
      asset: row.asset,
      intervalSec: row.intervalSec ? Number(row.intervalSec) : null,
      symbol: `${row.asset ?? "?"}-${row.strike ?? "0"}-${row.nonce ?? "?"}/captured`,
      yesSymbol: `${row.asset ?? "?"}#YES`,
      noSymbol: `${row.asset ?? "?"}#NO`,
      poolAddress: row.poolAddress,
      nonce: row.nonce,
      collateral: params.collateralToken,
      collateralDecimals: config.decimals,
      tradingStartSec: row.tradingStart ? Number(row.tradingStart) : undefined,
      expirySec: chain.expirySec,
      strike: row.strike,
      question: row.question,
    },
    assembledAt: capturedAt,
    onchain: ok({
      status: chain.status,
      statusName: statusName(chain.status),
      tradable: chain.status === 1,
      isResolved: chain.isResolved,
      isVoided: chain.isVoided,
      // Only meaningful when resolved; the payout vector is empty here.
      winningOutcome: chain.payoutNumerators.length
        ? chain.payoutNumerators.indexOf(
            chain.payoutNumerators.reduce((a, b) => (b > a ? b : a), 0n),
          )
        : 0,
      finalized: params.finalized,
      expirySec: chain.expirySec,
      backing: chain.backing.toString(),
    }),
    book,
    prices: ok(prices),
    move: degraded("captured fixture: move is derived on replay from `prices`"),
    flow: ok(flow),
    freshness: ok(
      freshness({
        lastTradeAtSec: flow.ageSec !== undefined ? nowSec - flow.ageSec : undefined,
        tradingStartSec: row.tradingStart ? Number(row.tradingStart) : undefined,
        expirySec: chain.expirySec,
        intervalSec: row.intervalSec ? Number(row.intervalSec) : undefined,
        nowSec,
      }),
    ),
    resolution: ok(resolutionState(row, oracle, nowSec)),
    row,
  };

  const assessment = gradeSnapshot(snapshot);
  console.log(
    `\n  ${BOLD}verdict at capture: ${assessment.verdict === "BLOCK" ? RED : YEL}${assessment.verdict}${R}` +
      `  confidence ${assessment.confidence}  rules: ${assessment.rules.map((r) => r.rule).join(", ")}`,
  );

  const fixture = {
    // What this fixture is FOR, in the file, so it is not archaeology later.
    note:
      "Frozen evidence for the stuck-market BLOCK case. Locked on-chain, unresolved, past the " +
      "voidable instant, while the indexer still reported Trading. voidExpired() is permissionless, " +
      "so this state is not reproducible by re-reading — grade the fixture, never the live market.",
    capturedAtMs: capturedAt,
    capturedAtSec: nowSec,
    capturedAtIso: new Date(capturedAt).toISOString(),
    network: config.network,
    chainId: config.chainId,
    marketId,
    addresses: {
      pool,
      market: params.market,
      collateralToken: params.collateralToken,
      outcomeToken: params.outcomeToken,
    },
    onchain: {
      ...chain,
      statusName: statusName(chain.status),
      lapsedPastVoidableSec: lapsedPastVoidable,
      poolFinalized: params.finalized,
      poolBooksEmpty: booksEmpty,
      marketNonce: params.marketNonce,
    },
    indexerClaimed: {
      clobStatus: row.clobStatus,
      finalized: row.finalized,
      voided: row.voided,
      // The whole point: what the indexer said at the same instant the chain
      // said Locked-and-unresolved.
      disagreesWithChain: row.clobStatus === "Trading" && chain.status !== 1,
    },
    restingOrders: {
      bids: resting.bids,
      asks: resting.asks,
    },
    raw: { row, oracle, candles: candleRows, fills: fillRows },
    snapshot,
    // Recorded so a regression shows up as a diff rather than a silent change.
    verdictAtCapture: {
      verdict: assessment.verdict,
      confidence: assessment.confidence,
      action: assessment.action,
      rules: assessment.rules,
      severities: assessment.signals.map((s) => ({ id: s.id, severity: s.severity })),
    },
  };

  const out = join(FIXTURE_DIR, `${label}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(jsonSafe(fixture), null, 2)}\n`);
  console.log(`\n  ${GRN}wrote${R} ${out.replace(process.cwd() + "/", "")}`);

  await ctx.exchange.close().catch(() => undefined);
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n${RED}capture failed${R}: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
