/**
 * Gate: the read-age phrase rolls to hours at the hour, and carries correctly.
 *
 *   cd apps/web && npm run check:age
 *
 * `elapsed` is the only formatter in this app that emits a COMPOUND value, and compound
 * durations fail in one specific way: rounding each unit on its own. Round 86,390 seconds
 * to hours and minutes independently and you get `24hr` — an hour that should have become
 * a day, printed by code that looks correct. That case cannot be reached by looking at the
 * page, because it lasts ten seconds a day.
 *
 * It also pins the boundary the whole change was about. A board 74 minutes old used to read
 * `74m ago`, because `duration` holds minutes to 90. This asserts 60 minutes is where hours
 * start, and that `duration` is UNCHANGED at the same input, since the countdown column
 * still wants the finer unit.
 *
 * Asserts:
 *   1. seconds hold below 90s, so `89s` is not rounded away to `1m`
 *   2. minutes run to 59, then hours start at exactly 60
 *   3. the compound reads `1hr 14m`, and drops a zero remainder to `1hr`
 *   4. the day boundary carries: 86,390s is `1d`, not `24hr`
 *   5. the minute carry: 59m30s is `1hr`, not `0hr 60m`
 *   6. days carry hours, not minutes
 *   7. `duration` is untouched — the table column still reads `74m` and `23h`
 *   8. `ago` clamps a future timestamp to `0s ago` rather than printing a negative
 */
import { ago, duration, elapsed } from "@/lib/format"

const R = "\x1b[0m"
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const RED = "\x1b[31m"
const GRN = "\x1b[32m"

let failed = 0
function eq(got: string, want: string, label: string): void {
  if (got === want) {
    console.log(`  ${GRN}pass${R} ${label} ${DIM}${got}${R}`)
  } else {
    failed += 1
    console.log(`  ${RED}FAIL${R} ${label}\n       ${DIM}want ${want}, got ${got}${R}`)
  }
}

console.log(`\n${BOLD}check:age${R} ${DIM}the read-age phrase${R}\n`)

// 1. Seconds hold below 90.
eq(elapsed(0), "0s", "zero")
eq(elapsed(45), "45s", "45 seconds")
eq(elapsed(89), "89s", "89s is not rounded to a minute")
eq(elapsed(90), "2m", "90s becomes minutes")

// 2. The boundary this change exists for.
eq(elapsed(59 * 60), "59m", "59 minutes stays minutes")
eq(elapsed(60 * 60), "1hr", "60 minutes is exactly where hours start")
eq(elapsed(74 * 60), "1hr 14m", "74 minutes, the case that read 74m")
eq(elapsed(260 * 60), "4hr 20m", "4hr 20m")

// 3. A zero remainder is dropped, never printed.
eq(elapsed(3 * 3600), "3hr", "a whole hour drops the minutes")
eq(elapsed(2 * 86_400), "2d", "a whole day drops the hours")

// 4-5. The carries. These are the assertions that catch per-unit rounding.
eq(elapsed(86_390), "1d", "86,390s carries to a day, not 24hr")
eq(elapsed(59 * 60 + 30), "1hr", "59m30s carries to 1hr, not 0hr 60m")
eq(elapsed(3599), "1hr", "3599s carries to 1hr")
eq(elapsed(24 * 3600 - 1), "1d", "one second short of a day is a day, not 24hr")

// 6. Days carry hours.
eq(elapsed(28 * 3600), "1d 4hr", "28 hours")
eq(elapsed(3 * 86_400 + 7 * 3600), "3d 7hr", "3d 7hr")

// 7. The table column is UNCHANGED. If this fails, the countdown lost its finer unit.
eq(duration(74 * 60), "74m", "duration still holds minutes to 90")
eq(duration(23 * 3600), "23h", "duration still reads 23h, not 23hr")
eq(duration(2 * 86_400), "2d", "duration still reads 2d")

// 8. Clock skew.
eq(ago(Date.now() + 60_000), "0s ago", "a future timestamp clamps to zero")

console.log("")
if (failed) {
  console.log(`${RED}${BOLD}FAIL${R} ${failed} assertion(s)\n`)
  process.exit(1)
}
console.log(`${GRN}${BOLD}PASS${R} the read age rolls at the hour and carries cleanly\n`)
