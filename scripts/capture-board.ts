/**
 * Freeze the whole board to a committed JSON fixture.
 *
 *   npm run capture:board
 *
 * Runs ONE live ingestion pass through `buildVenueRead`, the same function the
 * dashboard calls, and writes the result to `fixtures/board.json`. Then
 * `FATHOM_FIXTURE=1` renders the dashboard from that file with no network in the
 * render path at all.
 *
 * TWO REASONS, and the second one matters more.
 *
 * The dev loop. A live pass is roughly 150 round trips plus up to two model calls.
 * The dashboard is almost entirely server components, so hot reload buys almost
 * nothing, and iterating on type and colour meant minutes of waiting per look with
 * a file watcher and a chain socket sitting on a 4-core VM.
 *
 * The demo. Three `grade` runs inside two hours produced 0 ALLOW / 10 RECHECK /
 * 0 BLOCK, then 0 / 4 / 6, then 0 / 9 / 1. Every one of those was correct; the
 * board simply moves with venue state. A frozen board is the only way to be sure
 * the screen shows the full range of verdicts on the day, instead of whatever the
 * venue happens to be doing in that minute.
 *
 * Deliberately imports the dashboard's own function rather than reimplementing the
 * pass. A capture that assembled rows itself would drift from what the page
 * renders, and a fixture that does not match the page is worse than no fixture.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The VALUE comes through a dynamic import; the TYPE comes through a normal one.
 *
 * A static `import { buildVenueRead }` stopped resolving once apps/web dropped
 * `type: module`: under tsx its `.ts` compiles to CommonJS, and Node's ESM lexer cannot
 * see the named exports through that wrapper, so the import throws "does not provide an
 * export named 'buildVenueRead'". A runtime `import()` resolves them correctly.
 *
 * `import type` is erased at compile time, so it never reaches that runtime boundary at
 * all — which means the real `VenueRead` can still be used here rather than a hand-written
 * structural copy. The first attempt at this file DID hand-write one, and it drifted from
 * `VenueRead` within minutes (missing `confidence`, a bogus index signature, `marketId`
 * optional when it is not). Describing a type you already have is how the description goes
 * wrong.
 */
import type { buildVenueRead as BuildVenueRead } from "../apps/web/lib/venue";

import {
  DEFAULT_STALE_AFTER_HOURS,
  committedBoardAgeHours,
  decideFloor,
} from "./capture-floor";

const { buildVenueRead } = (await import("../apps/web/lib/venue")) as {
  buildVenueRead: typeof BuildVenueRead;
};

const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const RED = "\x1b[31m";

const OUT = join(import.meta.dirname, "..", "fixtures", "board.json");

/**
 * Markets to include that the venue sweep cannot reach, appended by id.
 *
 * `0x…c067` is the stuck-market BLOCK case: Locked on-chain, unresolved, 1503 tUSDC
 * stranded past a settlement window that closed days ago, while the indexer still reports
 * `clobStatus: "Trading"`. `liveMarkets` filters `expiry: {_gt: now}`, so ingestion cannot
 * see it — and without it a frozen board is ALLOW and RECHECK only, which cannot show the
 * engine using its full range. It is also the strongest single piece of evidence in the
 * product: the venue contradicting itself, checkable by anyone with an RPC.
 *
 * Two things keep this honest rather than a thumb on the scale. The row arrives with a
 * negative `secToExpiry` and `MarketList` flags it "past expiry" in the severe ink, so it
 * cannot read as tradable. And if the id cannot be reached it lands in `read.failures` and
 * is printed below, rather than the board quietly coming back one row short.
 *
 * `voidExpired()` is permissionless, so this state is not reproducible: the day someone
 * calls it, the market resolves and this entry stops being interesting. That is why
 * `fixtures/stuck-market-c067.json` exists separately and `test:risk` grades it.
 */
const ALSO_INCLUDE: string[] = [];

/**
 * `0x…c067` USED TO LIVE HERE, AND IT IS GONE. Re-read on chain 2026-09-08 at block
 * 483,110,892: `isVoided()` is now **true** (it was false), `status()` is 5 (it was 2,
 * Locked), and the pool has RECYCLED — `marketNonce` moved 164 → 165 and
 * `getBinaryPoolParams().market` now returns `0xcc4A9adE…` where it returned
 * `0x27f6DE3d…` at capture. Someone called `voidExpired()`, which is permissionless, and
 * the 1503 tUSDC was redeemed. This was always the one claim that could decay, and it did.
 *
 * The consequence for THIS script mattered more than the lost row: the id was no longer in
 * the SDK registry sweep, so every pass exited 1 and the board could not refresh at all.
 * A guard that permanently blocks the thing it is guarding is not protecting anything.
 *
 * The evidence is NOT deleted. `fixtures/stuck-market-c067.json` still holds the full
 * frozen state — status 2, unresolved, unvoided, 1503 tUSDC backing, a settlement window
 * lapsed 10 days — and `test:risk` still grades it, so the engine's BLOCK on that shape is
 * still exercised on every run. The market simply cannot be pointed at live any more, and
 * saying otherwise on camera would be claiming a fact that a judge with an RPC can
 * disprove in one call.
 *
 * The guard below is deliberately UNCHANGED. If a market is ever requested by id again, a
 * board without it is still a failed capture. Nothing is currently requested.
 */

async function main(): Promise<void> {
  if (process.env.FATHOM_FIXTURE) {
    console.error(
      `${RED}FATHOM_FIXTURE is set${R}, so this would capture the fixture it is reading. ` +
        `Unset it and run again.`,
    );
    process.exit(2);
  }

  // A frozen board is written once and read all day, so it can afford to wait for
  // the model on every market rather than the two a live request can pay for. The
  // 429 retry inside the provider paces itself; the cost is minutes here, once.
  process.env.FATHOM_EXPLAIN_BUDGET ??= "99";

  console.log(`${BOLD}capture:board${R} ${DIM}one live pass, then freeze${R}\n`);
  const started = Date.now();
  const read = await buildVenueRead({ alsoMarketIds: ALSO_INCLUDE });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const tally = read.rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});
  const explained = Object.values(read.traces).filter(
    (t) => t.explanation.source === "model",
  ).length;

  console.log(
    `  ${read.rows.length} market(s) in ${elapsed}s · ` +
      `ALLOW ${tally.ALLOW ?? 0} RECHECK ${tally.RECHECK ?? 0} BLOCK ${tally.BLOCK ?? 0} · ` +
      `${explained}/${Object.keys(read.traces).length} model-explained`,
  );

  // The per-market table, so the mix is readable before anything is frozen. A tally alone
  // does not say WHICH market is the BLOCK, and that is the one worth confirming.
  console.log("");
  for (const r of read.rows) {
    const expired = r.secToExpiry <= 0;
    const win = r.intervalSec ? `${Math.round(r.intervalSec / 60)}m` : "?";
    console.log(
      `    ${(r.asset ?? "?").padEnd(4)} ${win.padStart(6)}  ` +
        `${r.verdict.padEnd(8)} ${DIM}conf ${r.confidence.toFixed(2)}  ` +
        `${String(r.unmeasured)} unmeasured${R}` +
        (expired ? `  ${RED}past expiry${R}` : ""),
    );
  }
  console.log("");

  if (read.failures.length) {
    console.log(`  ${YEL}${read.failures.length} market(s) could not be snapshotted${R}`);
    for (const f of read.failures) {
      console.log(`    ${DIM}${f.marketId.slice(-6)} — ${f.reason}${R}`);
    }
  }

  // An explicitly requested market that did not arrive is a FAILED capture, not a warning.
  // The whole reason `ALSO_INCLUDE` exists is that the board needs a specific market in it;
  // writing a fixture without it would be silently freezing the wrong board.
  const missing = ALSO_INCLUDE.filter(
    (id) => !read.rows.some((r) => r.marketId.toLowerCase() === id.toLowerCase()),
  );
  if (missing.length) {
    console.error(
      `\n${RED}not written${R}: ${missing.length} explicitly requested market(s) are absent ` +
        `(${missing.map((m) => m.slice(-6)).join(", ")}). See the failures above — the board ` +
        `was asked for these by id, so a fixture without them is not the board that was requested.`,
    );
    process.exit(1);
  }

  // A board with one verdict in it is a fixture that cannot demonstrate the
  // engine discriminating. Worth saying out loud rather than discovering it on
  // the day, but not worth refusing to write: sometimes the venue really is
  // uniform, and a uniform board is still better than a two-minute page load.
  const distinct = Object.keys(tally).length;
  if (distinct < 2) {
    console.log(
      `  ${YEL}note${R} every market graded ${Object.keys(tally)[0] ?? "nothing"}. ` +
        `Fine for the dev loop, thin for a demo — recapture when the board has spread.`,
    );
  } else if (distinct < 3) {
    console.log(
      `  ${YEL}note${R} two of three verdicts present (${Object.keys(tally).join(", ")}). ` +
        `Usable, but the full range is the thing worth showing.`,
    );
  }

  /**
   * `FATHOM_MIN_VERDICTS` — refuse to write a board thinner than this. OFF by default.
   *
   * A warning is the right response when a PERSON runs this: they read the tally and decide
   * whether to keep it. It is the wrong response for a robot on a schedule, which will
   * happily overwrite a board showing all three verdicts with seven RECHECKs because the
   * venue happened to roll a generation where nothing had traded yet. The board's verdict
   * spread is the demo's whole point, and an unattended job must not be able to regress it.
   *
   * So CI sets `FATHOM_MIN_VERDICTS=3` and a thin pass exits 3 having written NOTHING —
   * distinct from exit 1 (a requested market was unreachable) so the workflow can tell
   * "the venue is uniform right now, try again later" from "something is broken".
   *
   * The floor is NOT constant: once the committed board is older than
   * `FATHOM_STALE_AFTER_HOURS` it drops to 2, because past that point a stale board with a
   * good tally is worse than a fresh one with a thinner tally — every hourly row on it has
   * lapsed. `decideFloor` owns that judgement and `check:floor` gates it. See
   * `scripts/capture-floor.ts` for why four hours and why the relaxed floor is 2.
   *
   * Deliberately a floor on DISTINCT verdicts rather than on specific ones. BLOCK is
   * guaranteed by the stuck market, so requiring 3 is exactly requiring that ALLOW and
   * RECHECK both appear — but saying it as a count keeps the check honest if that fixture
   * ever stops being reachable, instead of silently passing on a hardcoded assumption.
   */
  const configuredFloor = Number(process.env.FATHOM_MIN_VERDICTS ?? 0) || 0;
  const staleAfterHours =
    Number(process.env.FATHOM_STALE_AFTER_HOURS ?? DEFAULT_STALE_AFTER_HOURS) ||
    DEFAULT_STALE_AFTER_HOURS;
  const decision = decideFloor({
    configured: configuredFloor,
    staleAfterHours,
    ageHours: committedBoardAgeHours(OUT, Date.now()),
  });

  if (configuredFloor > 0) {
    console.log(`  ${DIM}floor: ${decision.why}${R}`);
  }

  if (decision.floor > 0 && distinct < decision.floor) {
    console.error(
      `\n${YEL}not written${R}: this pass produced ${distinct} distinct verdict(s) ` +
        `(${Object.keys(tally).join(", ") || "none"}) against a floor of ${decision.floor}` +
        `${decision.relaxed ? ` (relaxed from ${configuredFloor} for staleness)` : ""}. ` +
        `The existing board is untouched. This is the venue being uniform, not a failure — ` +
        `the next scheduled pass will try again.`,
    );
    process.exit(3);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(read, null, 2)}\n`);
  console.log(
    `\n  ${GRN}wrote${R} ${OUT.replace(`${process.cwd()}/`, "")}\n` +
      `  ${DIM}render from it with FATHOM_FIXTURE=1 (this is what \`npm run dev\` does)${R}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n${RED}capture:board failed${R}: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
