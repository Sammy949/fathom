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
 */
const FIGURE =
  "font-data inline-flex items-baseline gap-x-1.5 text-sm align-baseline sm:table-cell sm:px-0 sm:py-4"

/**
 * Where each figure sits in the mobile grid, stated explicitly.
 *
 * Auto-flow will not do this. With three tracks (two for the figures, one holding the
 * verdict at the right margin) the fourth figure flows into the verdict's column and the
 * 2x2 collapses into a 3+1 that overflows a 320px screen by 58px — measured, after two
 * other track shapes failed the same way for different reasons. Naming the cell is the
 * only arrangement that cannot drift: two columns, two rows, whatever the strings are.
 */
const AT = {
  midCell: "col-start-1 row-start-2",
  spreadCell: "col-start-2 row-start-2",
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

export function MarketList({ rows }: { rows: MarketRow[] }) {
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
           * Past expiry, and the board must say so.
           *
           * Keyed off the DATA, not off how the row got here. `liveMarkets` filters
           * `expiry: {_gt: now}` so ingestion cannot normally produce this, but
           * `buildVenueRead({ alsoMarketIds })` appends markets by id for the capture, and a
           * market can also lapse between a capture and someone reading it. Either way the
           * row must not read as tradable, and testing the field means both cases are
           * covered by one branch rather than by remembering to tag one of them.
           */
          const expired = r.secToExpiry <= 0

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
               needs more air between rows than between its own lines. `gap-y-2` does the
               within-row half, and `gap-x-6` separates the two figure columns. */
            <TableRow
              key={r.marketId}
              className="group relative grid grid-cols-[auto_auto] items-baseline gap-x-6 gap-y-2 py-5 min-[360px]:grid-cols-[auto_auto_minmax(0,1fr)] sm:table-row sm:gap-0 sm:py-0"
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
                      "past expiry" changes what every number after it means. */}
                  {expired ? (
                    <span
                      data-expired
                      className="text-xs font-medium"
                      style={{ color: "var(--ink-severe)" }}
                    >
                      past expiry {duration(-r.secToExpiry)}
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
                  countdown does not apply any more. */}
              <TableCell
                className={`${FIGURE} ${AT.expiresCell} text-muted-foreground`}
                data-expires
              >
                <span className={FIGURE_LABEL}>expires</span>
                {expired ? NO_READING : duration(r.secToExpiry)}
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
                  is a reading rather than a second target. */}
              <TableCell className="pointer-events-none col-span-2 col-start-1 row-start-4 px-0 pt-1 pb-0 align-baseline min-[360px]:col-span-1 min-[360px]:col-start-3 min-[360px]:row-start-1 min-[360px]:pt-0 min-[360px]:text-right sm:table-cell sm:pt-0 sm:text-left">
                <VerdictMark verdict={r.verdict} size="sm" />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
