/**
 * Gate: a market's loading shell is a MARKET, not the board again.
 *
 *   cd apps/web && npm run check:loading
 *
 * Next resolves `loading.tsx` from the nearest segment upward. `app/m/[id]/` had none, so
 * tapping a row on the board fell through to `app/loading.tsx` and the wait for a single
 * market rendered the board's headline, the board's filter chips and eight board rows —
 * the shape of the page you just left. The transition read as a reload rather than a
 * navigation, and on a phone that is the entire feedback a tap gets.
 *
 * The failure is SILENT: delete `app/m/[id]/loading.tsx` and nothing breaks, nothing warns,
 * the route just quietly starts showing the wrong page again. That is what this gate is
 * for. It renders both shells and asserts they are different pages, by their content rather
 * than by their existence — a file that exists but re-exports the board shell would pass an
 * existence check and fail this one.
 *
 * Asserts:
 *   1. the market shell carries the detail route's own landmarks
 *   2. it does NOT carry the board's headline or column labels
 *   3. the board shell still does carry them (the gate can tell them apart at all)
 *   4. the two shells differ substantially, not by a word
 *   5. neither shell hides content behind an animation — no opacity-0 start state
 */
import { readFileSync } from "node:fs"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import BoardLoading from "@/app/loading"
import MarketLoading from "@/app/m/[id]/loading"

/**
 * The board headline, read from the shell rather than pinned here.
 *
 * This gate used to assert the literal "Every verdict here is computed in code", and the
 * moment that copy was rewritten the gate failed for a change that was correct. A guard
 * that has to be edited whenever the words change is not measuring the invariant; the
 * invariant is that the SHELL and the PAGE say the same thing, and that the market shell
 * says none of it. So the headline is extracted from the board shell and then required to
 * appear in `app/page.tsx` verbatim, which is the assertion that actually matters: a
 * skeleton whose headline differs from the page's makes the sentence rewrite itself in
 * front of the reader when the read lands.
 */
const HEADLINE = /<h1[^>]*>([^<]+)<\/h1>/

const R = "\x1b[0m"
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const RED = "\x1b[31m"
const GRN = "\x1b[32m"

let failed = 0
function check(ok: boolean, label: string, detail?: string): void {
  if (ok) console.log(`  ${GRN}pass${R} ${label}`)
  else {
    failed += 1
    console.log(`  ${RED}FAIL${R} ${label}${detail ? `\n       ${DIM}${detail}${R}` : ""}`)
  }
}

const market = renderToStaticMarkup(createElement(MarketLoading))
const board = renderToStaticMarkup(createElement(BoardLoading))
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

console.log(`\n${BOLD}check:loading${R} ${DIM}the two waits are two pages${R}\n`)

// 1. The market shell says which route is coming.
const marketText = text(market)
// "Before acting" and the ladder are asserted too, because the shell's job is the page's
// SHAPE: the page answers before it argues, and a skeleton that opens on the book instead
// makes the reader watch three sections rearrange when the read lands.
for (const landmark of [
  "all markets",
  "Before acting",
  "Where the evaluation stopped",
  "The book, as displayed",
  "Settlement",
  "confidence",
]) {
  check(marketText.includes(landmark), `the market shell shows "${landmark}"`)
}

// 2. And says nothing that belongs to the board.
const boardHeadline = (board.match(HEADLINE)?.[1] ?? "").trim()
check(boardHeadline.length > 0, "the board shell has a headline at all", boardHeadline)

const boardOnly = [boardHeadline, "spread pt", "Reading the venue"]
for (const s of boardOnly) {
  check(!marketText.includes(s), `the market shell does NOT show "${s}"`)
}

// 3. The board shell's headline is the PAGE's headline, verbatim. This is what makes
//    assertion 2 mean anything, and it is read from source rather than pinned to a string
//    so that rewriting the copy cannot fail the gate while the two files still agree.
const boardText = text(board)
const pageSource = readFileSync(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
)
check(
  pageSource.includes(boardHeadline),
  "the board shell's headline is the board page's headline, verbatim",
  `shell: ${boardHeadline}`,
)
check(boardText.includes("market") && boardText.includes("verdict"), "the board shell still labels its columns")

// 4. Different pages, not a reworded one. Compared on the skeleton COUNT, since that is
//    what a reader actually perceives: eight rows versus one market's worth of blocks.
const bars = (html: string) => (html.match(/data-slot="skeleton"/g) ?? []).length
check(
  bars(market) !== bars(board),
  `the two shells are different shapes ${DIM}(market ${bars(market)}, board ${bars(board)})${R}`,
)

// 5. Nothing is hidden behind an entrance animation in either shell.
for (const [name, html] of [["market", market], ["board", board]] as const) {
  check(!/opacity-0|invisible/.test(html), `the ${name} shell renders visible with no JS`)
}

console.log("")
if (failed) {
  console.log(`${RED}${BOLD}FAIL${R} ${failed} assertion(s)\n`)
  process.exit(1)
}
console.log(`${GRN}${BOLD}PASS${R} a market's wait looks like a market\n`)
