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

import { buildVenueRead } from "../apps/web/lib/venue";

const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const RED = "\x1b[31m";

const OUT = join(import.meta.dirname, "..", "fixtures", "board.json");

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
  const read = await buildVenueRead();
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
  if (read.failures.length) {
    console.log(`  ${YEL}${read.failures.length} market(s) could not be snapshotted${R}`);
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
