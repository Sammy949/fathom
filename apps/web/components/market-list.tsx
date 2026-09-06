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
 * ONE `<table>`, ONE DATA PATH, TWO LAYOUTS. The reflow is `display` on the same cells
 * (`sm:table-cell`), not a second component and not a duplicated row. A second markup path
 * is how the past-expiry flag ends up present in one view and missing in the other, and
 * that flag is a hard requirement — `npm run check:expiry` asserts it in BOTH layouts for
 * exactly this reason.
 */

import Link from "next/link"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { VerdictMark } from "@/components/verdict-mark"
import { duration, NO_READING, points, prob, shortId, windowLabel } from "@/lib/format"
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
 * inside the gutter on the widest phone in common use, so the strip wraps to two lines on
 * EVERY phone — which is fine, but it means the gaps decide whether it reads as two lines or
 * as a jam. `gap-x-3` between pairs (12px) rather than `pr-4` (16px): still a clear break
 * between one figure and the next, and it buys back 16px across the strip, which is most of
 * the overflow. `gap-y-1.5` because a wrapped line needs vertical air that a table row does
 * not.
 */
const FIGURE =
  "font-data inline-flex items-baseline gap-x-1.5 mr-3 text-sm align-baseline sm:table-cell sm:mr-0 sm:px-0 sm:py-4"

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
      <p className="text-muted-foreground py-16 text-center text-sm">
        No markets on this venue are currently long enough to assess. Windows under 15 minutes
        expire before a verdict can be read.
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

               `block` below `sm` is what lets the cells stack; `sm:table-row` restores the
               row. `relative` carries the stretched link at both widths.

               `py-5` on mobile against `sm:py-0` (the cells carry their own `sm:py-4`): the
               row is genuinely three lines tall on a phone — identity, then two wrapped
               lines of figures — so it needs more air between rows than between its own
               lines, or the rules stop reading as row boundaries. `gap-y-1.5` on the figure
               wrapper below does the within-row half.

               `flex flex-wrap` below `sm` rather than relying on inline flow: the cells are
               `inline-flex`, and inline-level boxes in a block container inherit its line
               height, which stacked the wrapped lines tighter than their own content wanted. */
            <TableRow
              key={r.marketId}
              className="group relative flex flex-wrap gap-y-1.5 py-5 sm:table-row sm:gap-y-0 sm:py-0"
            >
              {/* `basis-full` keeps the identity on its own line at mobile; `pr-24` reserves
                  the width the absolutely-positioned verdict occupies, so a long identity
                  line cannot run under RECHECK. Both cleared at `sm`, where the verdict has
                  its own column. */}
              <TableCell className="basis-full px-0 py-0 pr-24 align-baseline sm:table-cell sm:pr-0 sm:py-4">
                {/* One real link per row, in the identity cell, its hit area stretched over
                    the whole row by `after:inset-0`. A `<tr>` cannot be wrapped in an `<a>`,
                    and making the row clickable with an onClick would take it away from the
                    keyboard — this keeps one focusable link with a real href while the whole
                    row stays a target. */}
                <Link
                  href={`/m/${shortId(r.marketId)}`}
                  className="flex flex-wrap items-baseline gap-x-2.5 outline-none after:absolute after:inset-0 group-hover:[&_[data-asset]]:text-primary group-focus-within:[&_[data-asset]]:text-primary"
                >
                  <span data-asset className="font-display text-lg leading-none">
                    {r.asset ?? NO_READING}
                  </span>
                  <span className="font-data text-muted-foreground text-xs">
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
                    <span className="text-xs" style={{ color: "var(--ink-unknown)" }}>
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
              <TableCell className={FIGURE}>
                <span className={FIGURE_LABEL}>mid</span>
                {prob(r.mid)}
              </TableCell>
              <TableCell className={FIGURE}>
                <span className={FIGURE_LABEL}>spread pt</span>
                {points(r.spread)}
              </TableCell>
              <TableCell className={`${FIGURE} text-muted-foreground`}>
                <span className={FIGURE_LABEL}>quote</span>
                {duration(r.quoteTtlSec)}
              </TableCell>
              {/* An expired market's countdown is the one figure that would actively
                  mislead — `duration` renders -646253 as `-7.5d`, which reads as a typo
                  rather than as a fact. The identity line states the lapse; this says the
                  countdown does not apply any more. */}
              <TableCell className={`${FIGURE} text-muted-foreground`} data-expires>
                <span className={FIGURE_LABEL}>expires</span>
                {expired ? NO_READING : duration(r.secToExpiry)}
              </TableCell>

              {/* The verdict. On mobile it is pulled up onto the identity line by
                  `absolute right-0 top-0` — the answer the board exists to give must be
                  readable without hunting for it, and at the end of a wrapped figure strip
                  it would be the last thing found rather than the first. At `sm` it returns
                  to its own column. `pointer-events-none` because the row-wide link sits
                  above it; the verdict is a reading, not a second target. */}
              <TableCell className="pointer-events-none absolute top-0 right-0 px-0 py-0 align-baseline sm:static sm:table-cell sm:py-4">
                <VerdictMark verdict={r.verdict} size="sm" />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
