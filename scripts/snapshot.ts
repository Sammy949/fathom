/**
 * Stage 2 verification gate. Read-only; sends no transactions.
 *
 *   npm run snapshot
 *
 * Prints a full `MarketSnapshot` for the demo markets and asserts the things that
 * would otherwise fail silently and poison every downstream verdict:
 *
 *   - the venue resolved and its live markets were found
 *   - the book is materialized, two-sided and NOT crossed
 *   - candles are scoped to ONE marketId (not the recycled pool)
 *   - fills yield flow direction and a real age
 *   - on-chain status agrees with the indexed row, or the disagreement is shown
 *   - every field carries provenance, so a degraded read is visibly degraded
 *     rather than silently zero
 */

import { createExchange, shutdown } from "@fathom/ec";
import {
  degradedFields,
  ingestVenue,
  isGradeable,
  liveVenues,
  type MarketSnapshot,
} from "@fathom/core";

const DIM = "\x1b[2m";
const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YEL = "\x1b[33m";
const GRN = "\x1b[32m";

const pct = (n: number | undefined, dp = 1) =>
  n === undefined ? "—" : `${(n * 100).toFixed(dp)}%`;
const p3 = (n: number | undefined) => (n === undefined ? "—" : n.toFixed(3));
const num = (n: number | undefined, dp = 2) => (n === undefined ? "—" : n.toFixed(dp));

function dur(sec: number | undefined): string {
  if (sec === undefined) return "—";
  const s = Math.abs(sec);
  const sign = sec < 0 ? "-" : "";
  if (s < 90) return `${sign}${Math.round(s)}s`;
  if (s < 5400) return `${sign}${Math.round(s / 60)}m`;
  if (s < 172800) return `${sign}${(s / 3600).toFixed(1)}h`;
  return `${sign}${(s / 86400).toFixed(1)}d`;
}

/** Problems that must fail the gate, distinct from a market merely looking risky. */
const problems: string[] = [];

function report(s: MarketSnapshot): void {
  const id = s.identity;
  const win = id.intervalSec ? dur(id.intervalSec) : "?";
  console.log(`\n${BOLD}${id.symbol}${R}  ${DIM}${id.asset} · ${win} window · marketId ${id.marketId.slice(-6)}${R}`);

  // ── on-chain (authoritative) ──────────────────────────────────────────────
  const oc = s.onchain.value;
  if (!oc) {
    console.log(`  onchain    ${RED}UNAVAILABLE${R} ${DIM}${s.onchain.provenance.state === "degraded" ? s.onchain.provenance.reason : ""}${R}`);
    problems.push(`${id.symbol}: on-chain read failed — nothing here is safe to act on`);
  } else {
    const flag = oc.tradable ? GRN : YEL;
    console.log(
      `  onchain    ${flag}${oc.statusName}${R}  tradable=${oc.tradable}  resolved=${oc.isResolved}  voided=${oc.isVoided}`,
    );
    // The indexer trails the chain, so this disagreement is expected sometimes —
    // worth SEEING rather than smoothing over, because it is exactly why writes
    // gate on the chain.
    const indexed = s.row.clobStatus;
    if (indexed && indexed !== oc.statusName) {
      console.log(`             ${YEL}indexer says "${indexed}", chain says "${oc.statusName}"${R} ${DIM}(indexer lags — chain wins)${R}`);
    }
  }

  // ── book (materialized) ───────────────────────────────────────────────────
  const b = s.book.value;
  if (!b) {
    console.log(`  book       ${RED}UNAVAILABLE${R}`);
    problems.push(`${id.symbol}: book read failed`);
  } else if (b.unusable) {
    const sev = b.unusable === "crossed" ? RED : YEL;
    console.log(`  book       ${sev}${b.unusable.toUpperCase()}${R}  bid=${p3(b.bid.best)} ask=${p3(b.ask.best)}`);
    // A crossed MATERIALIZED book is not a risky market, it is a broken read —
    // the exact failure mode that made indexer `Order` rows unusable.
    if (b.unusable === "crossed") {
      problems.push(
        `${id.symbol}: materialized book is CROSSED (bid ${p3(b.bid.best)} >= ask ${p3(b.ask.best)}) — the read is wrong, not the market`,
      );
    }
  } else {
    console.log(
      `  book       bid=${p3(b.bid.best)} ask=${p3(b.ask.best)}  mid=${p3(b.mid)}  spread=${p3(b.spread)} (${pct(b.spreadPct)})`,
    );
    console.log(
      `             ${DIM}levels ${b.bid.levels}/${b.ask.levels} · near±${b.nearBand} shares ${num(b.bid.nearShares)}/${num(b.ask.nearShares)} · imbalance ${num(b.imbalance, 3)}${R}`,
    );
  }

  // ── price history ─────────────────────────────────────────────────────────
  const pts = s.prices.value;
  const mv = s.move.value;
  if (!pts) {
    console.log(`  prices     ${YEL}unavailable${R}`);
  } else if (pts.length === 0) {
    console.log(`  prices     ${DIM}no candles — market has not traded in this bucket${R}`);
  } else {
    const first = pts[0];
    const last = pts[pts.length - 1];
    console.log(
      `  prices     ${pts.length} candle(s)  ${p3(first?.close)} → ${p3(last?.close)}  ${DIM}span ${dur(mv?.spanSec)}${R}`,
    );
    if (mv?.insufficient) {
      console.log(`             ${DIM}too few samples for a move metric (have ${mv.samples}) — reported as unknown, not zero${R}`);
    } else if (mv) {
      console.log(`             ${DIM}maxStep ${p3(mv.maxStep)} · net ${p3(mv.netChange)} · volume ${num(mv.volume)}${R}`);
    }
    // Candles are per-trade, so gaps are normal and a smooth line would be a lie.
    // Show the largest gap so the charting decision is grounded in real data.
    let maxGap = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const c = pts[i];
      if (a && c) maxGap = Math.max(maxGap, c.t - a.t);
    }
    if (maxGap > 0) console.log(`             ${DIM}largest gap between candles: ${dur(maxGap)} (sparse — never interpolate)${R}`);
  }

  // ── flow + freshness ──────────────────────────────────────────────────────
  const f = s.flow.value;
  const fr = s.freshness.value;
  if (f) {
    console.log(
      `  flow       ${f.count} fill(s)  takerBuy=${num(f.takerBuyShares)} takerSell=${num(f.takerSellShares)}  skew=${num(f.skew, 2)}  vwap=${p3(f.vwap)}`,
    );
    if (f.mintedShares > 0) {
      console.log(`             ${DIM}${num(f.mintedShares)} shares via mint-a-pair (two buyers, no seller)${R}`);
    }
  }
  if (fr) {
    const rel = fr.ageVsWindow !== undefined ? ` (${pct(fr.ageVsWindow)} of window)` : "";
    console.log(
      `  freshness  last trade ${dur(fr.lastTradeAgeSec)} ago${rel}  ·  expires in ${dur(fr.secToExpiry)}  ·  window ${pct(fr.windowElapsed)} elapsed`,
    );
    if (fr.recencyUnknown) {
      // Distinct from "never traded", and the distinction is the point: this is a
      // read that did not land, not a market that has been quiet.
      console.log(`             ${YEL}trade recency could not be established${R} ${DIM}(fills read did not land, row carries no lastTradeAt)${R}`);
    } else if (fr.neverTraded) {
      console.log(`             ${DIM}never traded${R}`);
    }
  }

  // ── resolution ────────────────────────────────────────────────────────────
  const rs = s.resolution.value;
  if (!rs) {
    console.log(`  resolution ${YEL}${s.resolution.provenance.state}${R} ${DIM}${"reason" in s.resolution.provenance ? s.resolution.provenance.reason : ""}${R}`);
  } else {
    console.log(`  resolution question ${rs.oracleQuestionId ?? "—"}  voided=${rs.oracleVoided ?? "—"}  reuse=${rs.reuseCount ?? "—"}`);
    if (rs.supersededByQuestionId) {
      console.log(`             ${RED}SUPERSEDED by question ${rs.supersededByQuestionId}${R}`);
    }
    if (rs.lapsedSec !== null) {
      console.log(`             ${YEL}past expiry ${dur(rs.lapsedSec)} with no answer posted — voidExpired() is callable${R}`);
    }
    if (rs.oracleExplorerUrl) console.log(`             ${DIM}${rs.oracleExplorerUrl}${R}`);
  }

  const dead = degradedFields(s);
  if (dead.length) console.log(`  ${YEL}degraded fields: ${dead.join(", ")}${R}`);
  console.log(`  ${DIM}gradeable: ${isGradeable(s) ? "yes" : "NO"}${R}`);
}

async function main(): Promise<void> {
  const ctx = createExchange({ withSigner: false });
  const { config } = ctx;

  console.log(`${BOLD}Fathom — Stage 2 snapshot${R}`);
  console.log(`${DIM}network ${config.network} (chain ${config.chainId}) · decimals ${config.decimals}${R}`);
  console.log(`${DIM}indexer ${config.indexerUrl}${R}`);

  // Venue ids move — both networks changed theirs three times in one week — so a
  // configured id silently matching nothing is a real failure mode. Show every
  // venue carrying live markets before trusting ours.
  const venues = await liveVenues(config.indexerUrl);
  console.log(`\n${BOLD}live venues${R}`);
  for (const v of venues) {
    const mine = v.venueId === config.venueId?.toLowerCase() ? `${GRN}← configured${R}` : "";
    console.log(`  ${v.venueId.slice(0, 14)}…  op=${String(v.operatorId).padEnd(3)} markets=${String(v.markets).padEnd(3)} ${mine}`);
    console.log(`    ${DIM}${(v.sampleQuestion ?? "").slice(0, 88)}${R}`);
  }
  if (config.venueId && !venues.some((v) => v.venueId === config.venueId?.toLowerCase())) {
    problems.push(
      `configured VENUE_ID ${config.venueId.slice(0, 14)}… carries no live markets — the id moved, read it off a live row`,
    );
  }

  // Windows under 15m expire before anyone can read a verdict, and the 60s/300s
  // series live on the pricefeed-test venue anyway.
  const result = await ingestVenue(ctx, { minIntervalSec: 900 });

  console.log(
    `\n${BOLD}snapshots${R} ${DIM}${result.snapshots.length} market(s), ${result.failures.length} failure(s), assembled ${new Date(result.assembledAt).toISOString()}${R}`,
  );
  for (const f of result.failures) console.log(`  ${RED}FAILED${R} ${f.marketId.slice(-6)}: ${f.reason}`);

  for (const s of result.snapshots) report(s);

  if (result.snapshots.length === 0) problems.push("no markets snapshotted at all");
  if (!result.usable) problems.push("no snapshot is gradeable — every one is missing on-chain state or a book");

  console.log(`\n${BOLD}gate${R}`);
  if (problems.length === 0) {
    console.log(`  ${GRN}PASS${R} — ${result.snapshots.length} gradeable snapshot(s), no contradictions`);
  } else {
    for (const p of problems) console.log(`  ${RED}FAIL${R} ${p}`);
  }

  await shutdown(ctx);
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n${RED}snapshot script failed${R}`);
  console.error(e);
  process.exit(1);
});
