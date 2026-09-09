/**
 * The market list: the first screen, and it has to answer "which of these can I act on"
 * without a click.
 *
 * A REAL `<table>`, and that is the point rather than a detail. This was a pair of CSS
 * grids — one for the heads, one per row — that lined up only because they shared a
 * template string. Nothing enforced it, and it drifted: the heads were right-aligned
 * while the cells sat left, so a figure never started under its own label. Two grids
 * agreeing by convention is not a column. One `<colgroup>` with `table-layout: fixed`
 * IS a column, guaranteed by the layout engine, and `<th scope="col">` says so to a
 * screen reader as well as to the eye.
 *
 * `table-layout: fixed` rather than auto for the same reason: with auto, a column's width
 * is decided by its widest current value, so `23.4h` counting down to `6m` would resize
 * the column and shift every neighbour on refresh. Fixed columns hold still.
 *
 * EVERYTHING IS LEFT-ALIGNED, including the figures, which reverses the usual advice.
 * Right-aligning numbers exists to line up decimals in RAGGED columns — 9.99 against
 * 1,204.50. Measured against the real board, these columns are uniform: `mid` is always
 * 5 characters, `spread` always 3, `quote` always 3, because every figure passes through
 * a fixed-precision formatter. When every value is the same width the digits land in the
 * same place either way, so right-alignment buys nothing here and costs the one thing a
 * table is for: a cell that does not start under its own heading is floating near a
 * column, not in one.
 *
 * Composed as a document rather than a card grid: rows on a shared baseline with 1px
 * rules, every figure in `.font-data` so the columns align on the decimal, and the
 * verdict carrying the row's ink weight. No cards, no hover-lift, no severity pills —
 * component-kit defaults that would flatten a genuinely ordered set of findings into
 * decoration. The card-with-a-big-probability-figure is also the pattern every
 * prediction market copied from Polymarket, which makes it the last thing this should
 * look like.
 *
 * WHY THE SOUNDING LEFT THIS ROW. It sat at the end: eight depth marks, one per signal,
 * meant to show the SHAPE of a market's risk before any words. Two measured facts killed
 * it. First, it barely varied — graded across the whole live board, the first four
 * columns (venue, resolution, liquidity, depth) read `ok` on every single row, so half of
 * every mark carried no information; ten rows produced six shapes and four of those
 * differed by one glyph. Second, and worse, it could not be read: a 64px mark encoded
 * severity as shape AND as depth AND confidence as line length across eight unlabelled
 * positions with no legend on the page. Nothing replaced it, deliberately. `unmeasured N`
 * states the fact that drove most of its variation in words that need no key, and the
 * detail page's gate ladder shows which check actually decided the verdict.
 *
 * WHY `quote` EARNS A COLUMN AND `last fill` LOST ONE. Quote life is the median seconds
 * until the resting book expires, and it exists nowhere else in this product's category:
 * `expireTimestampNs` is per order on the chain read and every aggregated view sums it
 * away. Last-trade age was showing the same fact as the staleness mark two inches to its
 * right, and the detail page states it in the only comparable form anyway, as a fraction
 * of the market's own window.
 *
 * ON A PHONE IT IS THE SAME TABLE, REFLOWED — not a scrolling one, and not a card grid.
 * Measured: the six columns need 416px of fixed width and the widest phone in common use
 * offers 382px inside the page gutter, so it overflows at EVERY phone width. Three
 * candidate answers, and only one survives what this row is for:
 *
 *   horizontal scroll   The verdict is the last column, so a reader would have to swipe
 *                       sideways to find out whether they can act — the single question
 *                       the board exists to answer. It also nests a horizontal scroll
 *                       region inside a vertical one, which is a gesture-disambiguation
 *                       problem on touch before it is a layout one.
 *   hide the figures    What the pre-table grid did (`hidden sm:block` on every figure).
 *                       Honest, but it leaves a phone with asset, window and verdict, and
 *                       the whole claim of this product is that a verdict is traceable to
 *                       numbers. Hiding the numbers on the device most people will open it
 *                       on is hiding the evidence.
 *   reflow, labelled    Two lines per row: identity, flags and verdict on the first; the
 *                       four figures beneath as `label value` pairs. Everything survives.
 *
 * The reflow needs the labels INLINE, and that is the part worth understanding rather than
 * copying. In a table the label lives once in the header and the column carries it down;
 * stacked, there is no column, so a bare `0.984` beside a bare `2.1` is four numbers and no
 * idea what any of them is. The header row is `hidden sm:table-row` precisely because it
 * cannot help here. So each figure carries its own `label-caps` on mobile and drops it at
 * `sm`, where the column heading takes the job back.
 *
 * THE REFLOW IS A GRID, NOT A WRAPPING FLEX ROW, and every number below came out of driving
 * a real browser at 320-639px rather than out of reading the CSS. The four figures used to be
 * laid out by their own intrinsic text widths and landed at x = 24, 121.8, 247.9, then 24
 * again on the second line: four unrelated axes, with `expires` under `mid` by accident. Which
 * figure began a line also changed with the viewport (2+2 at 320px, 3+1 from 375px up), so the
 * shape of the block depended on how wide the strings happened to be. A table's whole job is
 * that a figure sits in a column, and wrapping by content length is the ragged-parallel-columns
 * failure in a smaller costume. Now every figure NAMES its cell (`AT` below): two columns, two
 * rows, holding at x = 24 and 133.8 from 320px all the way to 639px.
 *
 * THOSE TWO NUMBERS ARE FROM BEFORE THE `p-2` REMOVAL and have not been re-measured: the cell
 * padding they were taken with is gone (see `FIGURE`), so column 1 now starts at 24 — on the
 * identity's own margin, which is the point of removing it — and column 2 sits 8px left of
 * 133.8. What holds regardless of the numbers is the invariant they were measuring: both
 * figure lines share one pair of column axes at every width, because each figure names its
 * cell.
 *
 * Auto-flow could not do it. Three track shapes were measured and rejected first: `1fr auto`
 * gave the first column half the viewport so the pair drifted apart as the screen grew (44px
 * of slack at 320px, 154px at 430px); `max-content max-content` with `justify-between` shoved
 * them to opposite rims 262px apart and overflowed 320px; `auto auto 1fr` let the fourth
 * figure flow into the verdict's column and collapse the 2x2 into a 3+1, overflowing 320px by
 * 58px. Naming the cell is the only arrangement that cannot drift.
 *
 * THE VERDICT IS A GRID ITEM, no longer absolutely positioned, and that fixed a real bug.
 * `absolute top-0 right-0` measured at EXACTLY 0px from the row's top edge — flush against the
 * rule dividing it from the row above, and a full line clear of its own asset — because `top-0`
 * resolves against the padding box, outside the `py-5`. Every verdict on a phone was glued to
 * the previous row's boundary, reading as though it belonged to that row. As a grid item it
 * shares the identity's line for real, which is what the old comment claimed and the layout did
 * not do, and it retires the `pr-24` that used to reserve room for it: two grid items cannot
 * overlap, so the guard is structural rather than a magic number.
 *
 * IT WRAPS BELOW 360px, because there the line genuinely cannot hold both. The arithmetic:
 * 272px usable inside the gutter against 85.8 + 114.1 of figures and 51 of RECHECK, which
 * needs the gap down to 8px to fit — and a row crushed to an 8px gutter to keep one element on
 * one line is worse than the wrap. So under 360px the verdict takes its own line under the
 * identity, and from 360px up it sits at the right margin. Verified at 359 and 360 either side
 * of the boundary: no overflow at any width from 320 up.
 *
 * ONE `<table>`, ONE DATA PATH, TWO LAYOUTS. The reflow is `display` on the same cells
 * (`sm:table-cell`), not a second component and not a duplicated row. A second markup path
 * is how the past-expiry flag ends up present in one view and missing in the other, and
 * that flag is a hard requirement — `npm run check:expiry` asserts it in BOTH layouts for
 * exactly this reason.
 */

import Link from "next/link"
import { useEffect, useState } from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { VerdictMark } from "@/components/verdict-mark"
import {
  duration,
  NO_READING,
  points,
  prob,
  shortId,
  windowLabel,
} from "@/lib/format"
import type { MarketRow } from "@/lib/venue"

/**
 * The columns, declared once. Heads and `<col>` widths come from this list, so a column
 * cannot exist in one place and not the other.
 *
 * Widths are sized to the HEAD, not the figure, because here the label is the wider of
 * the two: `spread pt` is 4.2rem of `label-caps` against 2.6rem of digits. One shared
 * 5rem for the four figure columns gives the block a regular rhythm; `market` is left
 * unset so it absorbs the remaining width, and `verdict` needs 6rem for RECHECK set in
 * the display face.
 *
 * The unit lives in the `spread pt` head rather than in every cell. A `pt` suffix per row
 * puts the unit on screen eight times to say one thing once, and it makes the figure's
 * own left edge depend on how many digits precede it.
 */
const COLUMNS = [
  { key: "market", label: "market", width: undefined },
  { key: "mid", label: "mid", width: "5rem" },
  { key: "spread", label: "spread pt", width: "5rem" },
  { key: "quote", label: "quote", width: "5rem" },
  { key: "expires", label: "expires", width: "5rem" },
  { key: "verdict", label: "verdict", width: "6rem" },
] as const

/**
 * A figure cell, at both widths.
 *
 * Below `sm` it is `inline-flex`, so the four figures flow inline as `label value` pairs and
 * wrap onto as many lines as the width needs; at `sm` it returns to `table-cell` and the
 * column heading takes the label's job. One class, one cell, both layouts — a second markup
 * path for mobile is how the past-expiry flag ends up in one view and missing from the
 * other.
 *
 * `align-baseline` matters at both widths for the same reason: the asset is 18px display and
 * these are 14px mono, and centring different sizes against each other leaves neither on a
 * shared baseline.
 *
 * SPACING IS MEASURED, NOT GUESSED. The four pairs render 400px wide against 382px available
 * inside the gutter on the widest phone in common use, so they cannot sit on one line at any
 * phone width — which is why they are two grid columns rather than a strip that wraps. The
 * `mr-3` that used to separate one pair from the next is gone: the grid's own `gap-x` does
 * that job now, and a margin on top of it would push the second column off its axis.
 *
 * `p-0`, AND IT IS LOAD-BEARING. `TableCell` ships shadcn's `p-2`, and the `sm:px-0 sm:py-4`
 * here only overrode it from `sm` up — different variant, so `tailwind-merge` kept both and
 * the base `p-2` stayed live below `sm`, where this cell is a grid item rather than a table
 * cell. It cost 8px on every side of every figure: the figures began 8px right of the asset
 * above them, so column 1 did not share the identity's left margin, and each figure line
 * carried 16px of vertical padding on top of the grid's own `gap-y`, which is most of what
 * made the block read as loose. Reported as two separate complaints — "align the lefts" and
 * "reduce the gap" — and they were one merge behaviour.
 */
const FIGURE =
  "font-data inline-flex items-baseline gap-x-1.5 p-0 text-sm align-baseline sm:table-cell sm:px-0 sm:py-4"

/**
 * Where each figure sits in the mobile grid, stated explicitly.
 *
 * Auto-flow will not do this. With three tracks (two for the figures, one holding the
 * verdict at the right margin) the fourth figure flows into the verdict's column and the
 * 2x2 collapses into a 3+1 that overflows a 320px screen by 58px — measured, after two
 * other track shapes failed the same way for different reasons. Naming the cell is the
 * only arrangement that cannot drift: two columns, two rows, whatever the strings are.
 *
 * THE FIRST FIGURE LINE CARRIES A TOP MARGIN, and that is one grid gap doing two jobs being
 * split into two. `row-gap` is a single value for every gap in the grid, so the 6px that
 * correctly separates the two figure lines from each other was also all that separated the
 * whole figure block from the identity above it — and those are different joints. Inside the
 * block the lines are one object and want to sit tight; between the identity and the block
 * there is a real break, because the first line answers the question and the rest is the
 * evidence for it. `mt-2` on row 2 only adds 8px there, for 14px against the block's own 6px,
 * and it is a margin rather than a larger `gap-y` precisely so the two figure lines keep the
 * spacing they already have. `sm:mt-0` because at `sm` these are table cells in one row and
 * there is no vertical joint to tune.
 */
const AT = {
  midCell: "col-start-1 row-start-2 mt-2 sm:mt-0",
  spreadCell: "col-start-2 row-start-2 mt-2 sm:mt-0",
  quoteCell: "col-start-1 row-start-3",
  expiresCell: "col-start-2 row-start-3",
} as const

/**
 * The label that only exists in the reflow, where there is no column heading above it.
 *
 * `mr-1.5` is dropped in favour of the cell's own `gap-x-1.5` — the two were stacking into a
 * 12px gap between a label and its own value, which read as a wider break than the one
 * separating whole pairs from each other. A label must sit closer to its value than to its
 * neighbour or the pairing inverts.
 */
const FIGURE_LABEL = "label-caps sm:hidden"

/**
 * The way-in mark, drawn once and used at both widths.
 *
 * Not an icon-pack import — `lucide` is already a dependency and this is deliberately not it.
 * Three points and a 1.5 round-capped stroke is the weight every other mark on this page is
 * drawn at, so the one glyph on the board belongs to the board.
 *
 * SIX BY TEN, AND THE TEN IS THE ALIGNMENT — in the mobile `View` mark, where this sits inline.
 * An `<svg>` is a replaced inline element, so its baseline is its own bottom edge: at 10px tall
 * it stands from the text baseline to roughly the cap height of the type beside it, landing in
 * the cap band rather than floating against the middle. That is why the height is stated here
 * and not left to `1em` — `align-middle` on a 10px glyph next to caps sits about 1.5px low, and
 * "nearly centred" is the failure this page is least allowed to make. The desktop hover mark
 * does not use that baseline at all: it is out of flow and centred on its cell.
 */
function WayIn({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="6"
      height="10"
      viewBox="0 0 6 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 1 L5 5 L1 9" />
    </svg>
  )
}

export function MarketList({ rows, assembledAt }: { rows: MarketRow[]; assembledAt: number }) {
  /**
   * Live clock for expiry countdown.
   *
   * Ticks every second so rows compute their remaining time against NOW rather than showing
   * a frozen delta from when the board was captured. A row that has expired says `past expiry`
   * per-row, rather than reciting a stale countdown like `expires 54m` when the market settled
   * hours ago. Same mechanism as ReadAge — staleness is this product's subject, so time has to
   * count honestly.
   */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  if (rows.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No markets on this venue are currently long enough to assess. Windows
        under 15 minutes expire before a verdict can be read.
      </p>
    )
  }

  return (
    <Table className="sm:table-fixed">
      {/* The columns themselves. This is what makes the heads and the cells one grid
          rather than two that happen to agree. Widths only bind at `sm`, since below it the
          cells leave the table grid entirely and a fixed 5rem would be a floor the reflow
          has to fight. */}
      <colgroup className="hidden sm:table-column-group">
        {COLUMNS.map((c) => (
          <col key={c.key} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>

      {/* Mono micro-labels, not a styled table header: no fill, no bold, no uppercase
          beyond what `label-caps` already sets. `scope="col"` because this is the only
          thing that tells a screen reader which figure belongs to which label.

          HIDDEN BELOW `sm`, and that is what forces the inline labels on the figures: a
          header row cannot label a stacked cell, and it would overflow here anyway. It
          stays in the DOM rather than being conditionally rendered so the table keeps one
          structure for assistive tech at every width. */}
      <TableHeader className="hidden sm:table-header-group">
        <TableRow className="hover:bg-transparent">
          {COLUMNS.map((c) => (
            <TableHead
              key={c.key}
              scope="col"
              className="label-caps h-auto px-0 pb-2 text-left align-baseline font-normal"
            >
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map((r) => {
          /**
           * Past expiry, computed from ABSOLUTE time against the live clock.
           *
           * Before this change, `expired` was keyed off the frozen `secToExpiry` from when the
           * board was captured, so a row said `expires 54m` when the market had actually settled
           * hours ago. Now: absolute expiry = `assembledAt/1000 + secToExpiry` (both in the data),
           * compared against `now` (ticking every second). A market that has expired says
           * `past expiry` with the real elapsed time, per row, rather than the whole page lying
           * about countdowns that stopped counting.
           *
           * This still tests the field rather than the path, so both cases are covered: markets
           * appended by id for the capture (which may already be expired at capture time), and
           * markets that lapse between a capture and someone reading it.
           */
          const absoluteExpiryMs = assembledAt + r.secToExpiry * 1000
          const secToExpiry = Math.floor((absoluteExpiryMs - now) / 1000)
          const expired = secToExpiry <= 0

          return (
            /* `align-baseline` on every cell, not `align-middle`. The asset is 18px display
               and the figures are 14px mono; centring those against each other puts them on
               two different baselines, which is the exact "everything is slightly off" a
               figure table cannot afford. One baseline per row.

               BELOW `sm` THIS IS A THREE-COLUMN GRID; at `sm` it is a table row again.

               The tracks are `auto auto 1fr`, and that shape was arrived at by measuring two
               wrong ones first. `1fr auto` gave the first figure column half the viewport, so
               the two figures drifted apart as the screen grew (44px of slack between them at
               320px, 154px at 430px) and read as two unrelated lists. `max-content max-content`
               with `justify-between` was worse: it pushed the tracks to opposite rims, 262px
               apart, and overflowed at 320px. What the row actually wants is the figures sized
               to their own content, sitting NEXT to each other, with the leftover width
               absorbed by a third empty track so the pair stays left and the verdict — placed
               explicitly in that third column — still lands at the right margin.

               `items-baseline` so the verdict sits on the asset's baseline rather than being
               centred against it at a different size. Verified with a zero-width inline probe,
               because a bounding box is not a baseline: the delta is 0.00px on every row.

               `py-5` on mobile against `sm:py-0` (the cells carry their own `sm:py-4`): the
               row is three lines tall on a phone — identity, then two rows of figures — so it
               needs more air between rows than between its own lines. `gap-y-1.5` does the
               within-row half, and `gap-x-6` separates the two figure columns.

               THE WITHIN-ROW GAP WAS NEVER WHAT IT SAID IT WAS. `gap-y-2` declared 8px, but
               each figure cell was also carrying a live `p-2` (see `FIGURE`), so the real
               distance between the identity and the figures under it was 8 + 8 = 16px, and
               between the two figure lines 8 + 16 = 24px — against 40px between neighbouring
               markets. At a 24:40 ratio the three lines of one market barely group, which is
               what "reduce the gap" was pointing at. Removing that padding is the fix; the
               declared gap comes down to 6px alongside it, so the lines of one market now sit
               6px apart inside a 40px break. Proximity is what groups them, and the gap inside
               a group has to be unmistakably smaller than the gap around it.

               `gap-y-1.5` IS THE FIGURE BLOCK'S OWN SPACING, not the row's. The joint between
               the identity and the block beneath it is wider, and it is set by `mt-2` on the
               first figure line rather than here (see `AT`): 6px inside the block, 14px above
               it, 40px between markets. One `row-gap` cannot say all three. */
            <TableRow
              key={r.marketId}
              /* `hover:bg-muted` at full strength, not the shadcn default's `/50`. Measured on
                 this palette that default lands at oklch 0.978 against a 0.992 ground — a
                 1.4% lightness step, which is why a mobile tester had no idea the row was a
                 target and why the desktop answer was nearly as quiet. Full `muted` is 0.965:
                 still a whisper, still ink-on-paper, but a step you can actually see. No lift,
                 no shadow, no border glow — the row is a line in a document and stays one. */
              className="group hover:bg-muted relative grid grid-cols-[auto_auto] items-baseline gap-x-6 gap-y-1.5 py-5 min-[360px]:grid-cols-[auto_auto_minmax(0,1fr)] sm:table-row sm:gap-0 sm:py-0"
            >
              {/* Column 1 of the identity line. The `pr-24` that used to reserve room for the
                  absolutely-positioned verdict is gone — the verdict is a grid item in column
                  2 now, and two grid items cannot overlap, so nothing needs reserving. */}
              <TableCell className="col-span-2 col-start-1 row-start-1 px-0 py-0 align-baseline sm:table-cell sm:py-4">
                {/* One real link per row, in the identity cell, its hit area stretched over
                    the whole row by `after:inset-0`. A `<tr>` cannot be wrapped in an `<a>`,
                    and making the row clickable with an onClick would take it away from the
                    keyboard — this keeps one focusable link with a real href while the whole
                    row stays a target. */}
                <Link
                  href={`/m/${shortId(r.marketId)}`}
                  className="flex flex-wrap items-baseline gap-x-2.5 outline-none after:absolute after:inset-0 group-focus-within:[&_[data-asset]]:text-primary group-hover:[&_[data-asset]]:text-primary"
                >
                  <span
                    data-asset
                    className="font-display text-lg leading-none"
                  >
                    {r.asset ?? NO_READING}
                  </span>
                  <span className="font-data text-xs text-muted-foreground">
                    {windowLabel(r.intervalSec)}
                  </span>
                  {/* Set in `--ink-severe`, the same register the detail page uses for a
                      blocking finding, because that is what this is: the window closed and
                      nothing can be done on it. It reads before the figures on purpose —
                      "past expiry" changes what every number after it means. Now computed from
                      absolute time so it counts honestly against the live clock. */}
                  {expired ? (
                    <span
                      data-expired
                      className="text-xs font-medium"
                      style={{ color: "var(--ink-severe)" }}
                    >
                      past expiry {duration(-secToExpiry)}
                    </span>
                  ) : null}
                  {r.unmeasured > 0 ? (
                    <span
                      className="text-xs"
                      style={{ color: "var(--ink-unknown)" }}
                    >
                      {r.unmeasured} unmeasured
                    </span>
                  ) : null}
                </Link>
              </TableCell>

              {/* Figures, ONE cell each at both widths. `duration` is called on the raw
                  value including null: it returns the no-reading mark itself, so a missing
                  reading cannot take a second code path to a differently-formatted blank.

                  Each carries a `label-caps` that only shows below `sm`, where the hidden
                  header row cannot label it. Above `sm` the label disappears and the column
                  heading takes over — same cell, same value, no duplicate markup. */}
              <TableCell className={`${FIGURE} ${AT.midCell}`}>
                <span className={FIGURE_LABEL}>mid</span>
                {prob(r.mid)}
              </TableCell>
              <TableCell className={`${FIGURE} ${AT.spreadCell}`}>
                <span className={FIGURE_LABEL}>spread pt</span>
                {points(r.spread)}
              </TableCell>
              <TableCell
                className={`${FIGURE} ${AT.quoteCell} text-muted-foreground`}
              >
                <span className={FIGURE_LABEL}>quote</span>
                {duration(r.quoteTtlSec)}
              </TableCell>
              {/* An expired market's countdown is the one figure that would actively
                  mislead — `duration` renders -646253 as `-7.5d`, which reads as a typo
                  rather than as a fact. The identity line states the lapse; this says the
                  countdown does not apply any more. Now uses the live computed secToExpiry
                  rather than the frozen r.secToExpiry. */}
              <TableCell
                className={`${FIGURE} ${AT.expiresCell} text-muted-foreground`}
                data-expires
              >
                <span className={FIGURE_LABEL}>expires</span>
                {expired ? NO_READING : duration(secToExpiry)}
              </TableCell>

              {/* The verdict: the answer the board exists to give, so on a phone it belongs on
                  the identity line rather than after four figures.

                  PLACED EXPLICITLY at row 1 / column 2 rather than reordered in the DOM. It is
                  the LAST cell because that is its table column at `sm`, and that source order
                  is also what a screen reader reads and what `<th scope=col>` maps onto — so
                  moving the markup to suit the small layout would trade a visual fix for a
                  semantic regression. `row-start-1 col-start-3` moves only the painted box.

                  This replaces `absolute top-0 right-0`, which measured 0px from the row's top
                  edge — flush against the rule above and 18px clear of its own asset's baseline.
                  A grid item cannot escape the row's padding that way.

                  `pointer-events-none` stays: the row-wide link sits above it, and the verdict
                  is a reading rather than a second target.

                  `sm:relative` AND NOT `relative`, which is the whole trick to the hover mark
                  below. From `sm` up this cell is the containing block for that mark, so it
                  pins to the cell's own right edge — the last column's edge, which is the
                  table's far end. Below `sm` the cell must NOT be positioned, because the
                  mobile `View` mark inside it anchors to the ROW instead, and giving this cell
                  a position would reel it in to the verdict's box. */}
              <TableCell className="pointer-events-none col-span-2 col-start-1 row-start-4 px-0 pt-1 pb-0 align-baseline min-[360px]:col-span-1 min-[360px]:col-start-3 min-[360px]:row-start-1 min-[360px]:pt-0 min-[360px]:text-right sm:relative sm:table-cell sm:pt-0 sm:text-left">
                <VerdictMark verdict={r.verdict} size="sm" />
                {/* THE ROW IS A LINK, AND ON A PHONE NOTHING SAID SO. Reported by someone
                    testing on mobile: they did not know a row could be opened. On a pointer
                    device the row answers that on hover — the ground shifts and the asset takes
                    the accent ink — and touch has no hover to answer with, so the affordance has
                    to be visible at rest.

                    A WORD, THEN A MARK. A lone arrow asks the reader to infer what it does; the
                    verb says it. `View` sits in the body face at the muted tone — not
                    `label-caps`, which this file reserves for the NAME OF A FIGURE, and this is
                    an action rather than a data label.

                    THE CHEVRON IS DRAWN HERE, six units wide, rather than imported. `lucide` is
                    already a dependency and this is deliberately not it: a 1.5-weight
                    round-capped stroke matching the marks this page already draws is three lines
                    of path, and it means the one icon on the board belongs to the board.

                    IT SITS BOTTOM-RIGHT, under the verdict, so the two things a reader wants
                    from a row — the answer, and the way in — share a right margin and bracket
                    the figures between them.

                    IT COSTS NO WIDTH ON ANY LINE IT COULD BREAK, and that is why it is
                    `absolute` rather than a grid item. As a cell in the third track it would
                    sit on the second figure line, whose column 2 ends about 248px in; at 320px
                    the row's content ends at 296px and `View ›` needs ~52px, so the two would
                    collide by roughly 4px on the narrowest phone in use. Out of flow it cannot
                    overlap anything and cannot widen the row at any viewport. `bottom-5` is
                    `py-5`, so its lower edge lands on the last line of the block: the figures
                    from 360px up, and the verdict's own line below 360px where that layout
                    already wraps. */}
                <span
                  aria-hidden
                  className="text-muted-foreground absolute right-0 bottom-5 flex items-center gap-x-1 text-xs sm:hidden"
                >
                  View
                  <WayIn />
                </span>

                {/* THE SAME MARK, EARNED BY HOVER, ON A POINTER DEVICE. The desktop row already
                    answers "this opens" with a ground shift and the asset taking accent ink;
                    neither says WHERE it opens, and a direction is the part a chevron carries.
                    It follows the verdict because the verdict is the last column, so the eye
                    finishes the row on it.

                    ONE AXIS, AT THE TABLE'S FAR END. Inline after the verdict it sat wherever
                    that word happened to stop — `ALLOW`, `RECHECK` and `BLOCK` are three
                    different widths, so a column of hovering marks would step in and out by
                    about 15px down the board. That is the ragged-parallel-columns failure in
                    miniature: a repeated element whose position is decided by the length of the
                    string beside it. `absolute right-2` against the cell's `sm:relative` pins
                    every one of them to one axis near the last column's right edge, whatever
                    the verdict says.

                    THE 8px IS THE POINT OF `right-2` RATHER THAN `right-0`. Flush at the
                    column's edge the mark sat ON the table's own right margin, reading as
                    something that had run out of room rather than something placed — the same
                    reason no other text on this page arrives at an edge with no gutter. 8px
                    lifts it clear while keeping the shared axis.

                    `top-1/2 -translate-y-1/2` centres it on the cell rather than trusting a
                    baseline it no longer shares, and out of flow it cannot reflow the cell
                    under the pointer at the moment of hovering — the one place a layout must
                    not move.

                    THE INK CARRIES THE RESTRAINT, NOT THE OPACITY. Left to inherit, the mark
                    took the cell's `foreground` — near-white on the dark ground, near-black on
                    paper — and read as a second headline beside the verdict, which is the
                    actual answer. The fix that matters is the TONE: `text-muted-foreground`,
                    the same ink every secondary reading on this page uses. It resolves to full
                    opacity, so the glyph is crisp rather than washed; 70% was tried first and
                    took a 6px stroke past quiet into faint. Dimming a mark that is already the
                    quiet colour just makes it hard to see.

                    Opacity only: no lift, no slide, no glow. 150ms is under the threshold where
                    a hover state starts to feel like an animation rather than a response, and
                    `motion-reduce` drops even that. `sm:block` because below `sm` the `View`
                    mark above is already doing this job, where there is no hover to do it. */}
                <WayIn className="text-muted-foreground absolute top-1/2 right-2 hidden -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none sm:block" />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
