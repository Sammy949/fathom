/**
 * Gate: the staleness escape hatch lowers the verdict floor, and only ever lowers it.
 *
 *   npm run check:floor
 *
 * `decideFloor` decides whether an unattended capture is allowed to overwrite the committed
 * board. Getting it wrong is expensive in both directions and silent in both: too strict and
 * the board ages out to a screen of lapsed rows (which is exactly what happened on
 * 2026-09-08, and is why this exists); too loose and a scheduled job quietly replaces a
 * board showing all three verdicts with one that shows one.
 *
 * Pure and synthetic on purpose — no venue, no network, no fixture — so it cannot go quiet
 * when the venue changes, and so the boundary cases can actually be reached. Ages that would
 * take four hours to observe are passed in directly.
 *
 * Asserts:
 *   1. fresh board, thin pass          -> refuses (the original guard still works)
 *   2. fresh board, full pass          -> writes
 *   3. stale board, 2 verdicts         -> writes (the escape hatch, floor 3 -> 2)
 *   4. stale board, 1 verdict          -> STILL refuses (2 is a floor, not a bypass)
 *   5. no readable board at all        -> treated as stale, so a repo can bootstrap
 *   6. relaxation never RAISES a floor (configured 2 stays 2 when stale)
 *   7. the floor is off entirely when unconfigured, at any age
 *   8. the boundary: exactly the threshold counts as stale
 *   9. a board dated in the future (clock skew) is not stale
 *  10. `committedBoardAgeHours` reads a real file, and survives a missing/corrupt one
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_STALE_AFTER_HOURS,
  RELAXED_FLOOR,
  committedBoardAgeHours,
  decideFloor,
} from "./capture-floor";

const R = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";

let failed = 0;
function check(ok: boolean, label: string, detail?: string): void {
  if (ok) {
    console.log(`  ${GRN}pass${R} ${label}`);
  } else {
    failed += 1;
    console.log(`  ${RED}FAIL${R} ${label}${detail ? `\n       ${DIM}${detail}${R}` : ""}`);
  }
}

/** Would a pass producing `distinct` verdicts be written, given a board this old? */
function writes(distinct: number, ageHours: number | null, configured = 3): boolean {
  const d = decideFloor({
    configured,
    staleAfterHours: DEFAULT_STALE_AFTER_HOURS,
    ageHours,
  });
  return d.floor === 0 || distinct >= d.floor;
}

console.log(`\n${BOLD}check:floor${R} ${DIM}the staleness escape hatch${R}\n`);

const FRESH = 1;
const STALE = DEFAULT_STALE_AFTER_HOURS + 2;

// 1-2. The original guard is untouched while the board is fresh.
check(!writes(2, FRESH), "a fresh board is not replaced by a 2-verdict pass");
check(writes(3, FRESH), "a fresh board is replaced by a 3-verdict pass");

// 3. The escape hatch itself.
const stale = decideFloor({
  configured: 3,
  staleAfterHours: DEFAULT_STALE_AFTER_HOURS,
  ageHours: STALE,
});
check(
  stale.floor === RELAXED_FLOOR && stale.relaxed,
  `a ${STALE}h board drops the floor 3 -> ${RELAXED_FLOOR}`,
  `got floor ${stale.floor}, relaxed ${stale.relaxed}`,
);
check(writes(2, STALE), "a stale board IS replaced by a 2-verdict pass");

// 4. Relaxed is not open. This is the assertion that keeps the hatch from becoming a bypass.
check(!writes(1, STALE), "a stale board is STILL not replaced by a 1-verdict pass");
check(!writes(0, STALE), "a stale board is STILL not replaced by a 0-verdict pass");

// 5. Bootstrapping: no board on disk must not deadlock the first capture.
check(writes(2, null), "a missing board is treated as stale, so a repo can bootstrap");
check(!writes(1, null), "a missing board still refuses a 1-verdict pass");

// 6. Relaxation lowers, never raises.
const alreadyLow = decideFloor({
  configured: 2,
  staleAfterHours: DEFAULT_STALE_AFTER_HOURS,
  ageHours: STALE,
});
check(
  alreadyLow.floor === 2 && !alreadyLow.relaxed,
  "a configured floor of 2 is not RAISED by going stale",
  `got floor ${alreadyLow.floor}, relaxed ${alreadyLow.relaxed}`,
);

// 7. Unconfigured means off, at any age. A person running this by hand gets warnings only.
check(
  writes(1, STALE, 0) && writes(1, FRESH, 0) && writes(0, null, 0),
  "an unconfigured floor never refuses, at any age",
);

// 8. The boundary. `>=` the threshold is stale, so the hatch cannot sit one second out of reach.
check(
  decideFloor({
    configured: 3,
    staleAfterHours: DEFAULT_STALE_AFTER_HOURS,
    ageHours: DEFAULT_STALE_AFTER_HOURS,
  }).floor === RELAXED_FLOOR,
  `exactly ${DEFAULT_STALE_AFTER_HOURS}h counts as stale`,
);
check(
  decideFloor({
    configured: 3,
    staleAfterHours: DEFAULT_STALE_AFTER_HOURS,
    ageHours: DEFAULT_STALE_AFTER_HOURS - 0.001,
  }).floor === 3,
  `a hair under ${DEFAULT_STALE_AFTER_HOURS}h does not`,
);

// 9. Clock skew must not open the hatch.
check(!writes(2, -5), "a board dated in the future is not stale");

// 10. The reader, against real files.
const dir = mkdtempSync(join(tmpdir(), "fathom-floor-"));
const now = Date.UTC(2026, 8, 8, 12, 0, 0);
const good = join(dir, "board.json");
writeFileSync(good, JSON.stringify({ assembledAt: now - 6 * 3_600_000, rows: [] }));
const age = committedBoardAgeHours(good, now);
check(age !== null && Math.abs(age - 6) < 1e-9, "reads a real board's age", `got ${age}`);

const corrupt = join(dir, "corrupt.json");
writeFileSync(corrupt, "{not json");
check(committedBoardAgeHours(corrupt, now) === null, "a corrupt board reads as null, not a crash");
check(
  committedBoardAgeHours(join(dir, "nope.json"), now) === null,
  "a missing board reads as null, not a crash",
);
const noField = join(dir, "nofield.json");
writeFileSync(noField, JSON.stringify({ rows: [] }));
check(
  committedBoardAgeHours(noField, now) === null,
  "a board with no assembledAt reads as null, not NaN",
);

console.log("");
if (failed) {
  console.log(`${RED}${BOLD}FAIL${R} ${failed} assertion(s)\n`);
  process.exit(1);
}
console.log(`${GRN}${BOLD}PASS${R} the floor relaxes for staleness, and only downward\n`);
