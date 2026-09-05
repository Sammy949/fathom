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

/** Figure cells: mono, tabular, one size, left on the column's own edge. */
const FIGURE = "font-data align-baseline px-0 py-4 text-sm"

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
    <Table className="table-fixed">
      {/* The columns themselves. This is what makes the heads and the cells one grid
          rather than two that happen to agree. */}
      <colgroup>
        {COLUMNS.map((c) => (
          <col key={c.key} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>

      {/* Mono micro-labels, not a styled table header: no fill, no bold, no uppercase
          beyond what `label-caps` already sets. `scope="col"` because this is the only
          thing that tells a screen reader which figure belongs to which label. */}
      <TableHeader>
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
        {rows.map((r) => (
          /* `align-baseline` on every cell, not `align-middle`. The asset is 18px display
             and the figures are 14px mono; centring those against each other puts them on
             two different baselines, which is the exact "everything is slightly off" a
             figure table cannot afford. One baseline per row.

             `relative` carries the stretched link below. */
          <TableRow key={r.marketId} className="group relative">
            <TableCell className="align-baseline px-0 py-4">
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
                {r.unmeasured > 0 ? (
                  <span className="text-xs" style={{ color: "var(--ink-unknown)" }}>
                    {r.unmeasured} unmeasured
                  </span>
                ) : null}
              </Link>
            </TableCell>

            {/* Figures. `duration` is called on the raw value including null: it returns
                the no-reading mark itself, so a missing reading cannot take a second code
                path to a differently-formatted blank. */}
            <TableCell className={FIGURE}>{prob(r.mid)}</TableCell>
            <TableCell className={FIGURE}>{points(r.spread)}</TableCell>
            <TableCell className={`${FIGURE} text-muted-foreground`}>
              {duration(r.quoteTtlSec)}
            </TableCell>
            <TableCell className={`${FIGURE} text-muted-foreground`}>
              {duration(r.secToExpiry)}
            </TableCell>

            <TableCell className="align-baseline px-0 py-4">
              <VerdictMark verdict={r.verdict} size="sm" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
