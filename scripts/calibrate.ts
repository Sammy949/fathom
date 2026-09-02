/**
 * Threshold calibration sweep. Read-only.
 *
 *   npm run calibrate
 *
 * Stage 4's thresholds have to come from THIS venue's observed distributions, not
 * from intuition about real-money order books. The venue is structurally unusual:
 * spreads run wide by real-market standards (2.5-2.9 points), the maker ladder is
 * perfectly symmetric so depth imbalance reads exactly 0.000 everywhere, and the
 * deepest market on the board can sit 70+ minutes without a trade.
 *
 * Thresholds guessed against a normal book would grade every market BLOCK, and a
 * verdict that fires on everything communicates nothing. So: measure first, then
 * pick cut points, then write them down with the numbers that justify them.
 *
 * Prints one row per market plus a distribution summary per metric.
 */

import { createExchange, shutdown } from "@fathom/ec";
import { executableShares, ingestVenue } from "@fathom/core";

const R = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

const n = (v: number | undefined, dp = 3) => (v === undefined ? "—" : v.toFixed(dp));

function pctiles(label: string, values: number[], dp = 3): void {
  if (values.length === 0) {
    console.log(`  ${label.padEnd(22)} ${DIM}no samples${R}`);
    return;
  }
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  console.log(
    `  ${label.padEnd(22)} n=${String(s.length).padEnd(3)} min=${n(s[0], dp)} p25=${n(at(0.25), dp)} med=${n(at(0.5), dp)} p75=${n(at(0.75), dp)} max=${n(s[s.length - 1], dp)}`,
  );
}

interface Row {
  symbol: string;
  window: number | null;
  mid?: number;
  spread?: number;
  spreadPct?: number;
  nearBid: number;
  nearAsk: number;
  imbalance?: number;
  execBuy: number;
  execSell: number;
  maxStep?: number;
  samples: number;
  skew?: number;
  ageSec?: number;
  ageVsWindow?: number;
  secToExpiry: number;
  windowElapsed?: number;
  minted: number;
  fills: number;
}

async function main(): Promise<void> {
  const ctx = createExchange({ withSigner: false });
  console.log(`${BOLD}Fathom — threshold calibration${R}`);
  console.log(`${DIM}${ctx.config.network} · decimals ${ctx.config.decimals}${R}\n`);

  // No minInterval filter here: the short windows are part of the distribution
  // even though we would never demo on them.
  const { snapshots } = await ingestVenue(ctx);

  const rows: Row[] = [];
  for (const s of snapshots) {
    const b = s.book.value;
    const mv = s.move.value;
    const f = s.flow.value;
    const fr = s.freshness.value;

    // Re-read the raw book for executable-size walks; bookMetrics keeps only aggregates.
    let execBuy = 0;
    let execSell = 0;
    try {
      const raw = await ctx.exchange.fetchOrderBook(s.identity.yesSymbol, 20);
      execBuy = executableShares(raw, "buy");
      execSell = executableShares(raw, "sell");
    } catch {
      /* leave at 0 — calibration tolerates a gap */
    }

    rows.push({
      symbol: s.identity.symbol,
      window: s.identity.intervalSec,
      mid: b?.mid,
      spread: b?.spread,
      spreadPct: b?.spreadPct,
      nearBid: b?.bid.nearShares ?? 0,
      nearAsk: b?.ask.nearShares ?? 0,
      imbalance: b?.imbalance,
      execBuy,
      execSell,
      maxStep: mv?.insufficient ? undefined : mv?.maxStep,
      samples: mv?.samples ?? 0,
      skew: f?.skew,
      ageSec: fr?.lastTradeAgeSec,
      ageVsWindow: fr?.ageVsWindow,
      secToExpiry: fr?.secToExpiry ?? 0,
      windowElapsed: fr?.windowElapsed,
      minted: f?.mintedShares ?? 0,
      fills: f?.count ?? 0,
    });
  }

  console.log(`${BOLD}per market${R}`);
  console.log(
    `${DIM}${"symbol".padEnd(30)} ${"win".padEnd(6)} ${"mid".padEnd(6)} ${"sprd".padEnd(6)} ${"sprd%".padEnd(7)} ${"nearB/A".padEnd(14)} ${"imbal".padEnd(7)} ${"skew".padEnd(6)} ${"cndl".padEnd(5)} ${"step".padEnd(6)} ${"age".padEnd(8)} ${"age/win".padEnd(8)} ttl${R}`,
  );
  for (const r of rows) {
    const win = r.window ? `${r.window / 60}m` : "?";
    console.log(
      `${r.symbol.padEnd(30)} ${win.padEnd(6)} ${n(r.mid, 3).padEnd(6)} ${n(r.spread, 3).padEnd(6)} ` +
        `${(r.spreadPct === undefined ? "—" : (r.spreadPct * 100).toFixed(1) + "%").padEnd(7)} ` +
        `${`${r.nearBid.toFixed(0)}/${r.nearAsk.toFixed(0)}`.padEnd(14)} ${n(r.imbalance, 3).padEnd(7)} ` +
        `${n(r.skew, 2).padEnd(6)} ${String(r.samples).padEnd(5)} ${n(r.maxStep, 3).padEnd(6)} ` +
        `${(r.ageSec === undefined ? "never" : `${Math.round(r.ageSec / 60)}m`).padEnd(8)} ` +
        `${(r.ageVsWindow === undefined ? "—" : (r.ageVsWindow * 100).toFixed(1) + "%").padEnd(8)} ` +
        `${Math.round(r.secToExpiry / 60)}m`,
    );
  }

  console.log(`\n${BOLD}distributions${R}`);
  pctiles("spread (points)", rows.map((r) => r.spread).filter((v): v is number => v !== undefined));
  pctiles("spread / mid", rows.map((r) => r.spreadPct).filter((v): v is number => v !== undefined));
  pctiles("mid", rows.map((r) => r.mid).filter((v): v is number => v !== undefined));
  pctiles("near depth (bid)", rows.map((r) => r.nearBid), 0);
  pctiles("near depth (ask)", rows.map((r) => r.nearAsk), 0);
  pctiles("imbalance", rows.map((r) => r.imbalance).filter((v): v is number => v !== undefined));
  pctiles("executable buy", rows.map((r) => r.execBuy), 0);
  pctiles("executable sell", rows.map((r) => r.execSell), 0);
  pctiles("flow skew", rows.map((r) => r.skew).filter((v): v is number => v !== undefined), 2);
  pctiles("candle samples", rows.map((r) => r.samples), 0);
  pctiles("maxStep (points)", rows.map((r) => r.maxStep).filter((v): v is number => v !== undefined));
  pctiles("last trade age (min)", rows.map((r) => (r.ageSec ?? 0) / 60).filter((v) => v > 0), 1);
  pctiles("age / window", rows.map((r) => r.ageVsWindow).filter((v): v is number => v !== undefined));
  pctiles("window elapsed", rows.map((r) => r.windowElapsed).filter((v): v is number => v !== undefined));
  pctiles("fills seen", rows.map((r) => r.fills), 0);

  // What actually separates markets here, and what is constant. A metric with no
  // spread across the venue cannot drive a verdict, however sensible it sounds.
  console.log(`\n${BOLD}discriminating power${R}`);
  const spreadOf = (vals: number[]) =>
    vals.length < 2 ? 0 : Math.max(...vals) - Math.min(...vals);
  const report = (label: string, vals: (number | undefined)[]) => {
    const clean = vals.filter((v): v is number => v !== undefined);
    const range = spreadOf(clean);
    const verdict = range === 0 ? "CONSTANT — cannot discriminate" : `range ${range.toFixed(3)}`;
    console.log(`  ${label.padEnd(22)} ${verdict}`);
  };
  report("spread / mid", rows.map((r) => r.spreadPct));
  report("imbalance", rows.map((r) => r.imbalance));
  report("flow skew", rows.map((r) => r.skew));
  report("age / window", rows.map((r) => r.ageVsWindow));
  report("near depth (bid)", rows.map((r) => r.nearBid));
  report("candle samples", rows.map((r) => r.samples));

  await shutdown(ctx);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
