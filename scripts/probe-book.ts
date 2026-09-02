/**
 * Book-read stability probe. Read-only, sends nothing.
 *
 *   npm run probe:book
 *
 * Not a gate. A measurement instrument, in the same genre as `calibrate.ts`: it
 * exists so a claim about read stability can be re-established rather than
 * remembered.
 *
 * THE QUESTION IT ANSWERS: can a SINGLE `fetchOrderBook` land in the maker's repost
 * gap and report an empty or thin book on a market that is actually fine? The engine
 * grades `unusable: "empty"` and `nearShares <= 50` as SEVERE, and severe is BLOCK,
 * so a bad-luck read would be a false BLOCK in front of a judge.
 *
 * MEASURED 2026-09-02: 270 reads across three markets, one a second for 90 seconds.
 * Zero empty, zero one-sided, zero under either depth threshold, and
 * `min(bid.nearShares, ask.nearShares)` came back exactly 990 every time. So the gap
 * is not observable here, and the "require the thin book across two consecutive
 * polls" rule was not built. Note what that 990 does and does not mean: those three
 * markets had never traded, so it is the size of an unconsumed ladder rather than a
 * venue constant. A later `grade` run read 200 near the touch on a market that had
 * been traded against.
 *
 * RE-RUN AN HOUR LATER, AND IT SETTLED THE QUESTION FROM THE OTHER SIDE. Two idle 24h
 * markets still read 990 on all 90 reads each. The third, a 4h market past its last
 * fill, read ONE-SIDED on 90 of 90 reads: `levels 0/3`, no bid at all, for the entire
 * 90 seconds. So the severe conditions that actually occur on this venue PERSIST -
 * the maker withdraws a side and leaves it withdrawn - and a two-poll rule would not
 * have softened that verdict, it would have confirmed it. Which is the answer: the
 * false-BLOCK-from-one-unlucky-read failure mode is not the one this venue produces.
 *
 * It also records the book's own `timestamp` per read, because if the SDK handed back
 * a cached view then "two consecutive polls" would be one observation twice and any
 * two-poll rule would be theatre. It does not: 90 of 90 timestamps were distinct on
 * every market, on every run.
 */

import { createExchange, shutdown } from "@fathom/ec";
import { bookMetrics, ingestVenue } from "@fathom/core";

const R = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YEL = "\x1b[33m";
const GRN = "\x1b[32m";

const DURATION_MS = 90_000;
const EVERY_MS = 1_000;

interface Read {
  at: number;
  bookTs: number;
  bidLevels: number;
  askLevels: number;
  nearMin: number;
  spread?: number;
  unusable?: string;
  error?: string;
}

async function main(): Promise<void> {
  const ctx = createExchange({ withSigner: false });
  console.log(`${BOLD}book read stability probe${R} ${DIM}${ctx.config.network}${R}`);

  const { snapshots } = await ingestVenue(ctx, { minIntervalSec: 900 });
  // Longest windows first: a market that expires mid-probe would confound the run.
  const targets = [...snapshots]
    .sort((a, b) => (b.identity.intervalSec ?? 0) - (a.identity.intervalSec ?? 0))
    .slice(0, 3)
    .map((s) => ({ symbol: s.identity.symbol, yes: s.identity.yesSymbol }));

  console.log(`${DIM}probing ${targets.length} market(s) every ${EVERY_MS}ms for ${DURATION_MS / 1000}s${R}`);
  for (const t of targets) console.log(`  ${t.symbol}`);

  const reads = new Map<string, Read[]>(targets.map((t) => [t.symbol, []]));
  const t0 = Date.now();

  while (Date.now() - t0 < DURATION_MS) {
    const tick = Date.now();
    await Promise.all(
      targets.map(async (t) => {
        try {
          const raw = await ctx.exchange.fetchOrderBook(t.yes, 10);
          const b = bookMetrics(raw);
          reads.get(t.symbol)!.push({
            at: Date.now(),
            bookTs: raw.timestamp ?? 0,
            bidLevels: b.bid.levels,
            askLevels: b.ask.levels,
            nearMin: Math.min(b.bid.nearShares, b.ask.nearShares),
            spread: b.spread,
            unusable: b.unusable,
          });
        } catch (e) {
          reads.get(t.symbol)!.push({
            at: Date.now(),
            bookTs: 0,
            bidLevels: -1,
            askLevels: -1,
            nearMin: -1,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }),
    );
    const wait = EVERY_MS - (Date.now() - tick);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  console.log(`\n${BOLD}results${R}`);
  for (const t of targets) {
    const rs = reads.get(t.symbol)!;
    const errors = rs.filter((r) => r.error);
    const good = rs.filter((r) => !r.error);
    const empty = good.filter((r) => r.unusable === "empty");
    const oneSided = good.filter((r) => r.unusable === "one-sided");
    const crossed = good.filter((r) => r.unusable === "crossed");
    const severeThin = good.filter((r) => !r.unusable && r.nearMin <= 50);
    const elevatedThin = good.filter((r) => !r.unusable && r.nearMin > 50 && r.nearMin <= 200);
    const distinctTs = new Set(good.map((r) => r.bookTs)).size;
    const nears = good.filter((r) => !r.unusable).map((r) => r.nearMin);

    // The one that matters: would this read alone have produced a severe liquidity
    // signal, and therefore a BLOCK?
    const wouldBlock = empty.length + oneSided.length + severeThin.length;

    console.log(`\n  ${BOLD}${t.symbol}${R}`);
    console.log(`    reads              ${rs.length} (${errors.length} error(s))`);
    console.log(`    distinct book ts   ${distinctTs} ${DIM}of ${good.length} good reads${R}`);
    // Guarded, because `Math.min(...[])` is Infinity and a market that was
    // one-sided for the whole window has no two-sided read to measure. That exact
    // artifact is what gave `npm run grade` away when it passed on an empty board,
    // and it turned up here on the first market that had no bids.
    console.log(
      nears.length > 0
        ? `    near-touch shares  min ${Math.min(...nears).toFixed(0)} max ${Math.max(...nears).toFixed(0)}`
        : `    near-touch shares  ${DIM}no two-sided read to measure${R}`,
    );
    console.log(`    empty              ${empty.length}`);
    console.log(`    one-sided          ${oneSided.length}`);
    console.log(`    crossed            ${crossed.length}`);
    console.log(`    thin (<=50 severe) ${severeThin.length}`);
    console.log(`    thin (<=200 elev)  ${elevatedThin.length}`);
    console.log(
      `    ${wouldBlock === 0 ? GRN : RED}would have graded SEVERE (=> BLOCK): ${wouldBlock} of ${good.length} reads${R}`,
    );

    // Longest consecutive stretch of severe-grading reads: the dwell a two-poll
    // rule would have to outlast.
    let run = 0;
    let longest = 0;
    for (const r of good) {
      const bad = r.unusable === "empty" || r.unusable === "one-sided" || (!r.unusable && r.nearMin <= 50);
      run = bad ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    if (longest > 0) {
      console.log(`    ${YEL}longest severe run  ${longest} consecutive read(s) ≈ ${(longest * EVERY_MS) / 1000}s${R}`);
      // Capped. A market that is one-sided for the whole window prints the same
      // line ninety times otherwise, which buries the summary above it — and the
      // fact worth reading is that the condition PERSISTED, which the run length
      // already states.
      const bad = good.filter(
        (r) => r.unusable === "empty" || r.unusable === "one-sided" || (!r.unusable && r.nearMin <= 50),
      );
      for (const r of bad.slice(0, 5)) {
        console.log(
          `      ${DIM}+${((r.at - t0) / 1000).toFixed(1)}s  ${r.unusable ?? "thin"}  levels ${r.bidLevels}/${r.askLevels}  nearMin ${r.nearMin.toFixed(0)}${R}`,
        );
      }
      if (bad.length > 5) {
        console.log(`      ${DIM}… and ${bad.length - 5} more, ${bad.length} of ${good.length} reads in all${R}`);
      }
    }
    if (errors.length) {
      console.log(`    ${DIM}first error: ${errors[0]?.error?.slice(0, 120)}${R}`);
    }
  }

  await shutdown(ctx);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
