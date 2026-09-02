/**
 * The market list: the first screen, and it has to answer "which of these can I
 * act on" without a click.
 *
 * Composed as a document rather than a card grid. Rows on a shared baseline with
 * 1px rules, every figure in `.font-data` so the columns align on the decimal, and
 * the verdict carrying the row's ink weight. The sounding line sits at the end:
 * eight signals, depth-marked, so a reader sees the SHAPE of a market's risk
 * before reading a single word.
 *
 * No cards, no hover-lift, no severity pills. Those are the component-kit defaults
 * and they would flatten a genuinely ordered set of findings into decoration. The
 * card-with-a-big-probability-figure is also the pattern every prediction market
 * copied from Polymarket, which makes it the last thing this should look like.
 *
 * WHY `quote life` EARNS A COLUMN AND `last fill` LOST ONE. Quote life is the
 * median seconds until the resting book expires, and it exists nowhere else in
 * this product's category: `expireTimestampNs` is per order on the chain read and
 * every aggregated view sums it away. Last-trade age was showing the same fact as
 * the staleness mark two inches to its right, and the detail page states it in the
 * only comparable form anyway, as a fraction of the market's own window.
 */

import Link from "next/link"

import { Sounding } from "@/components/sounding"
import { VerdictMark } from "@/components/verdict-mark"
import { duration, NO_READING, points, prob, shortId, windowLabel } from "@/lib/format"
import type { MarketRow } from "@/lib/venue"

/** One grid template, declared once, so heads and rows cannot drift apart. */
const COLS =
  "grid grid-cols-[1fr_auto] gap-4 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_5rem_4.5rem_auto]"

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
    <div>
      {/* Column heads. Mono micro-labels, not a styled table header. `quote life`
          is one word now because two wrapped into the sounding column below it. */}
      <div className={`${COLS} text-muted-foreground items-end border-b pb-2`}>
        <span className="label-caps">market</span>
        <span className="label-caps hidden text-right sm:block">mid</span>
        <span className="label-caps hidden text-right sm:block">spread</span>
        <span className="label-caps hidden text-right sm:block">quote</span>
        <span className="label-caps hidden text-right sm:block">expires</span>
        <span className="label-caps text-right">verdict</span>
      </div>

      <ul>
        {rows.map((r) => (
          <li key={r.marketId} className="border-b">
            <Link
              href={`/m/${shortId(r.marketId)}`}
              className={`${COLS} group items-center py-4 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40`}
            >
              {/* Identity, at triage weight. The full symbol and the market id used
                  to sit here in a second line; both are reference for a market you
                  have already picked, not information that helps you pick one, so
                  they moved to the detail header. What survives is what a reader
                  chooses by: which asset, over what window, and how much of the
                  read is missing. */}
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
                <span className="font-display text-lg leading-none group-hover:text-primary">
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
              </div>

              {/* Figures. Right-aligned and tabular so they scan as a column. */}
              <span className="font-data hidden text-right text-sm sm:block">{prob(r.mid)}</span>
              <span className="font-data hidden text-right text-sm sm:block">
                {points(r.spread)}
                <span className="text-muted-foreground text-[0.65rem]">pt</span>
              </span>
              <span className="font-data text-muted-foreground hidden text-right text-sm sm:block">
                {r.quoteTtlSec === null ? NO_READING : duration(r.quoteTtlSec)}
              </span>
              <span className="font-data text-muted-foreground hidden text-right text-sm sm:block">
                {duration(r.secToExpiry)}
              </span>

              {/* Verdict plus the sounding: the shape of the risk, before the words. */}
              <div className="flex items-center justify-end gap-4">
                <Sounding
                  signals={r.severities}
                  confidence={r.confidence}
                  className="hidden sm:block"
                />
                <VerdictMark verdict={r.verdict} size="sm" className="text-right" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
