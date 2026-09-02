/**
 * The market list — the first screen, and it has to answer "which of these can I
 * act on" without a click.
 *
 * Composed as a document, not a card grid. Rows on a shared baseline with 1px
 * rules, every figure in `.font-data` so the columns align on the decimal, and
 * the verdict as the heaviest element in each row. The sounding line sits at the
 * end of the row: seven signals, depth-marked, so a reader can see the SHAPE of
 * a market's risk before reading a single word.
 *
 * No cards, no hover-lift, no severity pills. Those are the component-kit
 * defaults and they would flatten a genuinely ordered set of findings into
 * decoration.
 */

import Link from "next/link"

import { Sounding } from "@/components/sounding"
import { VerdictMark } from "@/components/verdict-mark"
import { duration, NO_READING, points, prob, shortId, windowLabel } from "@/lib/format"
import type { MarketRow } from "@/lib/venue"

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
      {/* Column heads. Mono micro-labels, not a styled table header. */}
      <div className="text-muted-foreground grid grid-cols-[1fr_auto] items-end gap-4 border-b pb-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_5rem_auto]">
        <span className="label-caps">market</span>
        <span className="label-caps hidden text-right sm:block">mid</span>
        <span className="label-caps hidden text-right sm:block">spread</span>
        <span className="label-caps hidden text-right sm:block">last fill</span>
        <span className="label-caps hidden text-right sm:block">expires</span>
        <span className="label-caps text-right">verdict</span>
      </div>

      <ul>
        {rows.map((r) => (
          <li key={r.marketId} className="border-b">
            <Link
              href={`/m/${r.marketId}`}
              className="group grid grid-cols-[1fr_auto] items-center gap-4 py-4 outline-none transition-colors sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_5rem_auto] focus-visible:bg-muted/40 hover:bg-muted/40"
            >
              {/* Identity. Asset and window are the typed fields; the symbol is
                  display-only and never parsed. */}
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-lg leading-none group-hover:text-primary">
                    {r.asset ?? NO_READING}
                  </span>
                  <span className="label-caps">{windowLabel(r.intervalSec)} window</span>
                  {r.unmeasured > 0 ? (
                    <span className="label-caps" style={{ color: "var(--sound-unknown)" }}>
                      {r.unmeasured} no reading
                    </span>
                  ) : null}
                </div>
                <p className="text-muted-foreground font-data mt-1 truncate text-xs">
                  {r.symbol}
                  <span className="opacity-50"> · {shortId(r.marketId)}</span>
                </p>
              </div>

              {/* Figures. Right-aligned and tabular so they scan as a column. */}
              <span className="font-data hidden text-right text-sm sm:block">{prob(r.mid)}</span>
              <span className="font-data hidden text-right text-sm sm:block">
                {points(r.spread)}
                <span className="text-muted-foreground text-[0.65rem]">pt</span>
              </span>
              <span className="font-data text-muted-foreground hidden text-right text-sm sm:block">
                {r.lastTradeAgeSec === null ? "never" : duration(r.lastTradeAgeSec)}
              </span>
              <span className="font-data text-muted-foreground hidden text-right text-sm sm:block">
                {duration(r.secToExpiry)}
              </span>

              {/* Verdict + the sounding. The shape of the risk, before the words. */}
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
