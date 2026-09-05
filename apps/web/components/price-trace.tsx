"use client"

import { useState } from "react"

import { duration } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Implied probability, as it actually printed.
 *
 * Replaces the sounding line that sat beside the confidence figure. That mark was
 * doing two jobs badly in that slot: the gate ladder further down now shows which
 * check decided the verdict, and the signal table shows each reading's depth inline,
 * so an eight-tick summary next to a number added a third encoding of the same
 * information. What was missing from the header was the market's own price history,
 * which is the one thing a trader looks for first and the page never showed.
 *
 * IT IS A STEP, AND THAT IS THE HONESTY ARGUMENT. Candle buckets on this venue are
 * emitted per trade rather than per interval, so the series is irregular by nature: a
 * market that did not trade for four hours has no points for four hours. Measured live
 * on 2026-09-03 across all ten live markets, only three carried the three points
 * `moveMetrics` requires, and the best had FIVE spanning 9h with a 240-minute hole —
 * 44% of the whole span in a single jump.
 *
 * Each point is a LAST-TRADED price. Between two prints no trade occurred, so the last
 * traded price was still the last traded price for that whole stretch: a flat hold is
 * literally what the data says. Then it jumps at the moment of the next trade, because
 * that is what a trade at a new price is. A diagonal ramp between prints would invent
 * gradual drift that never happened — smoothing is only defensible when samples are
 * periodic, and here they are not. So the line holds and steps, and every pixel of it
 * corresponds to something measured.
 *
 * This replaced an earlier attempt that split the series into runs at any gap above 3x
 * the median and dashed the crossings. It was WRONG IN PRACTICE and the render proved
 * it: with five prints the median gap is itself 120 minutes, so a 240-minute hole is
 * only 2x and the rule never fired — it drew a confident diagonal straight through the
 * hole it existed to mark. A heuristic tuned on 51 points was dead on 5. The step needs
 * no threshold at all, which is why it is right: there is no tuning left to be wrong.
 *
 * The final hold runs to the READ TIME, not to the last print, and this is the same
 * argument one step further. If horizontal width means elapsed time, then the time
 * between the last trade and the moment the snapshot was taken is width that exists, and
 * ending the line at the last print quietly claims that print was now. Measured live on
 * 2026-09-03: the last print on BTC 24h was 144 minutes old, 26% of the chart's width.
 * A reader looking at the old shape saw a market that had just traded at 0.780.
 *
 * That trailing shelf is drawn in the same ink as every other hold, because it is the
 * same claim — the last traded price is still the last traded price — but it ends in NO
 * DOT, because no trade has closed it yet. Every other shelf on the chart terminates in
 * a print; this one just stops. The absence is the label, so no extra ink is needed to
 * say it, and the caption names the age in words so the figure is legible rather than
 * merely implied by width.
 *
 * Long holds are NOT scored on the line, and that was a wrong turn worth recording. A
 * dash along every shelf above some fraction of the span fired on 4 of 4 holds at these
 * sample counts — with five prints the average hold is a quarter of the span, so any
 * threshold low enough to catch a long one catches them all, and a mark on everything
 * says nothing. It also beaded the solid stroke into a dashed one, fighting the single
 * clean line the shape exists to be. Three things already carry that fact without it:
 * the step refuses to interpolate, the dots say where a reading exists, and the caption
 * names the longest hold in hours. A fourth encoding is the same redundancy this chart
 * replaced the sounding for.
 *
 * Under three points there is no chart at all, matching `moveMetrics`, which refuses to
 * compute a move below `MIN_SAMPLES_FOR_MOVE` and reports `insufficient` rather than a
 * confident zero. Seven of ten live markets take that path today. A dot plot of one
 * point is not a smaller chart, it is a misleading one.
 *
 * Interaction is hover-to-read: the nearest point highlights and its close and time
 * print above the plot. No tooltip that follows the cursor, no crosshair sweeping the
 * full height, no animated draw-on. The reason is the anti-slop law and Apple's
 * "motion must be motivated" both landing in the same place: the value of this chart
 * is reading an exact figure at an exact moment, so the interaction that earns its
 * place is the one that puts a real number on screen.
 *
 * A note on the fill. It is a flat wash of the ink at low alpha closing onto the low
 * datum, not a gradient fading to transparent. A gradient under a sparkline is the
 * default move and it reads as atmosphere; a flat tint bottoming out on a drawn line
 * reads as the region the price occupied, which is what it is.
 */

interface Point {
  t: number
  close: number
  volume: number
}

/**
 * Below this mean horizontal spacing (viewBox units) the per-print dots are dropped.
 * Four dot diameters: any tighter and they merge into texture on the line rather than
 * reading as individual marks. At W=320 this shows dots up to ~40 prints.
 */
const DOT_MIN_SPACING = 8

export function PriceTrace({
  points,
  intervalSec,
  assembledAt,
  insufficientNote,
  className,
}: {
  /**
   * Optional on purpose. `prices` was added to `DecisionTrace` after
   * `fixtures/board.json` was captured, so the committed frozen board has no such
   * field and `FATHOM_FIXTURE=1` hands this `undefined`. Defaulting to an empty array
   * degrades to the engine's own "too few buckets" sentence instead of throwing, which
   * is the correct behaviour for a fixture that genuinely carries no series. Recapture
   * the board and the chart appears.
   */
  points?: Point[]
  intervalSec: number | null
  /**
   * Wall clock (ms) the snapshot was assembled — `DecisionTrace.assembledAt`.
   *
   * The final hold extends to this, so the chart's right edge is the read rather than
   * the last trade. Optional because a caller without it should still get a chart; the
   * line then ends at the last print, which understates the age of the reading but does
   * not misstate any price.
   */
  assembledAt?: number
  /** The engine's own sentence, shown instead of a chart when there is too little. */
  insufficientNote?: string
  className?: string
}) {
  const [active, setActive] = useState<number | null>(null)

  const sorted = [...(points ?? [])].sort((a, b) => a.t - b.t)

  // Match the engine: below three samples there is nothing to plot. Say what the
  // engine says rather than drawing a chart of one dot.
  if (sorted.length < 3) {
    return (
      <div className={cn("max-w-[22rem]", className)}>
        <p className="label-caps mb-1.5">price</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {insufficientNote ??
            `Only ${sorted.length} price ${sorted.length === 1 ? "bucket" : "buckets"} printed, fewer than the 3 needed to read a move.`}
        </p>
      </div>
    )
  }

  const W = 320
  const H = 64
  const PAD = 3

  const t0 = sorted[0]!.t
  const lastPrint = sorted[sorted.length - 1]!
  /**
   * The right edge of the time axis: the read, when we know it and it is after the last
   * print. `Math.max` guards the case where a cached board's `assembledAt` predates a
   * price point — the axis must never run backwards.
   */
  const readAt = assembledAt ? Math.floor(assembledAt / 1000) : lastPrint.t
  const tEnd = Math.max(lastPrint.t, readAt)
  const sinceLastPrint = tEnd - lastPrint.t
  const span = Math.max(1, tEnd - t0)

  const closes = sorted.map((p) => p.close)
  const lo = Math.min(...closes)
  const hi = Math.max(...closes)
  // A flat series still needs a band, or every point lands on one row.
  const range = hi - lo < 0.02 ? 0.02 : hi - lo
  const mid = (hi + lo) / 2
  const yLo = mid - range / 2
  const yHi = mid + range / 2

  const x = (t: number) => PAD + ((t - t0) / span) * (W - PAD * 2)
  const y = (c: number) => PAD + (1 - (c - yLo) / (yHi - yLo)) * (H - PAD * 2)

  /**
   * The step itself: hold the last traded price, then jump at the next print.
   *
   * Two vertices per print rather than one — arrive at the previous price, then rise or
   * fall in place — so every horizontal segment is a real hold and every vertical one is
   * a real trade. `L` throughout, no curves: a curve would round the corner of a jump
   * into a ramp and put the price at values it never took. The final segment carries the
   * last traded price out to the read time, so the chart's width is the age of the
   * evidence rather than only the span of the trades.
   */
  const stepPath = (() => {
    let d = `M ${x(t0)} ${y(sorted[0]!.close)}`
    for (let i = 1; i < sorted.length; i++) {
      d += ` L ${x(sorted[i]!.t)} ${y(sorted[i - 1]!.close)} L ${x(sorted[i]!.t)} ${y(sorted[i]!.close)}`
    }
    if (sinceLastPrint > 0) d += ` L ${x(tEnd)} ${y(lastPrint.close)}`
    return d
  })()

  const base = y(lo)
  /** The same step, closed onto the low datum, as the filled region. */
  const areaPath = `${stepPath} L ${x(tEnd)} ${base} L ${x(t0)} ${base} Z`

  /**
   * The longest stretch with no trade, the trailing one included.
   *
   * Named in the caption rather than drawn, because at these sample counts a mark on
   * every long hold is a mark on every hold. See the header note.
   */
  const longestHold = Math.max(
    sinceLastPrint,
    ...sorted.slice(1).map((p, i) => p.t - sorted[i]!.t),
  )

  const net = lastPrint.close - sorted[0]!.close
  const shown = active === null ? null : sorted[active]

  /** Mean horizontal distance between prints, which decides whether dots can show. */
  const spacing = (W - PAD * 2) / (sorted.length - 1)

  return (
    <div className={cn("max-w-[22rem]", className)}>
      {/* The readout sits ABOVE the plot and holds its height whether or not
          anything is hovered, so the layout cannot jump on mouse-in. Its default is
          the fact a reader wants without touching anything: the net move. */}
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <p className="label-caps">price</p>
        <p className="font-data text-xs">
          {shown ? (
            <>
              {shown.close.toFixed(3)}
              <span className="text-muted-foreground ml-1.5 tracking-normal">
                {clockOf(shown.t)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {net >= 0 ? "+" : ""}
              {(net * 100).toFixed(1)} pt over {sorted.length} prints
            </span>
          )}
        </p>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className="overflow-visible"
        role="img"
        aria-label={`Implied probability, ${sorted.length} trades from ${sorted[0]!.close.toFixed(3)} to ${lastPrint.close.toFixed(3)}. Held flat between trades because none occurred${sinceLastPrint > 0 ? `, and still held at ${lastPrint.close.toFixed(3)} for the ${duration(sinceLastPrint)} since the last trade` : ""}. Longest such hold ${duration(longestHold)}.`}
        onMouseLeave={() => setActive(null)}
      >
        {/* The band the series moved within, as a datum rather than a grid. One line
            at the extremes; no graph paper. The low line is also the floor the fill
            closes onto, so the shaded region has a stated bottom. */}
        <line x1={0} y1={y(hi)} x2={W} y2={y(hi)} stroke="var(--border)" strokeWidth={0.5} />
        <line x1={0} y1={y(lo)} x2={W} y2={y(lo)} stroke="var(--border)" strokeWidth={0.5} />

        {/* The region the price occupied, under the step and closed onto the low line.
            Drawn first so the stroke sits on top of its own fill. */}
        <path d={areaPath} fill="var(--foreground)" opacity={0.08} />

        {/* The price: hold, jump, hold. One unbroken stroke through every print, carried
            out to the read time. `butt` caps, because a round cap would push the stroke
            half its width past the last x and read as a tiny overhang past "now". */}
        <path
          d={stepPath}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1.5}
          strokeLinecap="butt"
          strokeLinejoin="miter"
        />

        {/* A dot at every print, but only while they cannot bead. `spacing` is the mean
            horizontal distance between prints in viewBox units; below roughly four dot
            diameters they stop reading as marks and become texture on the line. On a step
            these matter more than on a smooth line: the corner of a jump looks like a
            data point and is not one, so the dots are what distinguish "a trade happened
            here" from "the line turned here". Measured live, every market that has a
            chart at all has 3 to 6 prints, so today they all show.

            The trailing shelf deliberately ends WITHOUT one: every other hold on this
            chart is closed by a trade, and that one is not closed yet. */}
        {spacing >= DOT_MIN_SPACING
          ? sorted.map((p) => (
              <circle
                key={`p-${p.t}`}
                cx={x(p.t)}
                cy={y(p.close)}
                r={2}
                fill="var(--background)"
                stroke="var(--foreground)"
                strokeWidth={1.25}
              />
            ))
          : null}
        {shown ? (
          <circle
            cx={x(shown.t)}
            cy={y(shown.close)}
            r={3}
            fill="var(--primary)"
            stroke="var(--background)"
            strokeWidth={1}
          />
        ) : null}

        {/* Hover targets: one invisible column per point, so the nearest print is picked
            without any distance maths, and the whole plot height is a target rather than a
            3px dot. The last column runs to the right edge, because the shelf out to the
            read time belongs to the last print — hovering it should report that print, not
            fall through to nothing. */}
        {sorted.map((p, i) => {
          const prev = i === 0 ? 0 : (x(sorted[i - 1]!.t) + x(p.t)) / 2
          const next =
            i === sorted.length - 1 ? W : (x(p.t) + x(sorted[i + 1]!.t)) / 2
          return (
            <rect
              key={`hit-${p.t}`}
              x={prev}
              y={0}
              width={Math.max(1, next - prev)}
              height={H}
              fill="transparent"
              onMouseEnter={() => setActive(i)}
            />
          )
        })}
      </svg>

      {/* What the picture cannot state precisely. `intervalSec` frames the span, because
          15 minutes of history means something different on a 15-minute market than on a
          24-hour one. The age of the last trade is stated in words as well as width: the
          trailing shelf shows there is dead time but not how much, and "no trade for 2.4h"
          is the figure a reader would otherwise have to estimate off the axis. */}
      <p className="text-muted-foreground mt-1.5 text-[0.7rem] leading-snug">
        {spanLabel(span, intervalSec)}
        {sinceLastPrint > 0 ? (
          <>
            {" · "}
            <span style={{ color: "var(--ink-unknown)" }}>
              no trade for {duration(sinceLastPrint)}
            </span>
          </>
        ) : longestHold > 0 ? (
          <>
            {" · "}
            <span style={{ color: "var(--ink-unknown)" }}>
              longest hold {duration(longestHold)} without a trade
            </span>
          </>
        ) : null}
      </p>
    </div>
  )
}

/** Wall-clock for a bucket, to the minute. Absolute, because a span is already shown. */
function clockOf(tSec: number): string {
  return new Date(tSec * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * The span the chart covers, and how much of the market's own window that is.
 *
 * "of history" rather than "of prints", because since the trailing hold runs to the read
 * time the span includes time in which nothing printed. Calling that width "prints" was
 * the caption making the same overclaim the old line made.
 */
function spanLabel(spanSec: number, intervalSec: number | null): string {
  const h = spanSec / 3600
  const span = h >= 1 ? `${h.toFixed(1)}h of history` : `${Math.round(spanSec / 60)} min of history`
  if (!intervalSec) return span
  return `${span}, ${Math.round((spanSec / intervalSec) * 100)}% of the window`
}
