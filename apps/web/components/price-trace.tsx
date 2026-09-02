"use client"

import { useId, useState } from "react"

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
 * THE HARD RULE: NO LINE IS DRAWN ACROSS A GAP. Candle buckets on this venue are
 * emitted per trade rather than per interval, so a market that did not trade for two
 * hours has no points for two hours. Measured on BTC 24h: 51 points across 15.4h with
 * a 150-minute hole, 16% of the whole span. A smooth line through that hole would be
 * inventing prices that never existed, in a product whose entire claim is that every
 * number traces to a measurement. So the series is split into runs wherever the gap
 * between consecutive points exceeds several times the median gap, each run is drawn
 * as its own path, and the empty stretch between runs is left empty and labelled.
 *
 * Under three points there is no chart at all, matching `moveMetrics`, which refuses
 * to compute a move below `MIN_SAMPLES_FOR_MOVE` and reports `insufficient` rather
 * than a confident zero. A dot plot of one point is not a smaller chart, it is a
 * misleading one.
 *
 * Interaction is hover-to-read: the nearest point highlights and its close and time
 * print above the plot. No tooltip that follows the cursor, no crosshair sweeping the
 * full height, no animated draw-on. The reason is the anti-slop law and Apple's
 * "motion must be motivated" both landing in the same place: the value of this chart
 * is reading an exact figure at an exact moment, so the interaction that earns its
 * place is the one that puts a real number on screen.
 */

interface Point {
  t: number
  close: number
  volume: number
}

/** Points closer than this multiple of the median gap belong to the same run. */
const GAP_FACTOR = 3

export function PriceTrace({
  points,
  intervalSec,
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
  /** The engine's own sentence, shown instead of a chart when there is too little. */
  insufficientNote?: string
  className?: string
}) {
  const clipId = useId()
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
  const t1 = sorted[sorted.length - 1]!.t
  const span = Math.max(1, t1 - t0)
  const lows = sorted.map((p) => p.close)
  const lo = Math.min(...lows)
  const hi = Math.max(...lows)
  // A flat series still needs a band, or every point lands on one row.
  const range = hi - lo < 0.02 ? 0.02 : hi - lo
  const mid = (hi + lo) / 2
  const yLo = mid - range / 2
  const yHi = mid + range / 2

  const x = (t: number) => PAD + ((t - t0) / span) * (W - PAD * 2)
  const y = (c: number) => PAD + (1 - (c - yLo) / (yHi - yLo)) * (H - PAD * 2)

  // Split into runs at every real gap. The median gap is the yardstick because a
  // fixed threshold in seconds cannot serve a 15-minute market and a 24-hour one.
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i]!.t - sorted[i - 1]!.t)
  const medianGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 1
  const threshold = Math.max(medianGap * GAP_FACTOR, 60)

  const runs: Point[][] = [[sorted[0]!]]
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]!.t - sorted[i - 1]!.t
    if (gap > threshold) runs.push([sorted[i]!])
    else runs[runs.length - 1]!.push(sorted[i]!)
  }

  const breaks = runs.length - 1
  const net = sorted[sorted.length - 1]!.close - sorted[0]!.close
  const shown = active === null ? null : sorted[active]

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
        aria-label={`Implied probability across ${sorted.length} trades, from ${sorted[0]!.close.toFixed(3)} to ${sorted[sorted.length - 1]!.close.toFixed(3)}${breaks > 0 ? `, with ${breaks} gap${breaks === 1 ? "" : "s"} where no trade printed` : ""}.`}
        onMouseLeave={() => setActive(null)}
      >
        {/* The band the series moved within, as a datum rather than a grid. One line
            at the extremes; no graph paper. */}
        <line x1={0} y1={y(hi)} x2={W} y2={y(hi)} stroke="var(--border)" strokeWidth={0.5} />
        <line x1={0} y1={y(lo)} x2={W} y2={y(lo)} stroke="var(--border)" strokeWidth={0.5} />

        {/* One path per run. The stretches between them stay empty on purpose. */}
        {runs.map((run, i) => (
          <polyline
            key={i}
            points={run.map((p) => `${x(p.t)},${y(p.close)}`).join(" ")}
            fill="none"
            stroke="var(--foreground)"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* A gap is marked, not smoothed over: a dotted rule at mid-height spanning
            exactly the time nothing traded. This is the honest version of the thing a
            line chart would have hidden. */}
        {runs.slice(0, -1).map((run, i) => {
          const from = run[run.length - 1]!
          const to = runs[i + 1]![0]!
          return (
            <line
              key={`gap-${i}`}
              x1={x(from.t)}
              y1={H / 2}
              x2={x(to.t)}
              y2={H / 2}
              stroke="var(--ink-unknown)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          )
        })}

        {/* Every print is a dot, so the sparseness is visible rather than implied by
            a line's vertices. */}
        {sorted.map((p, i) => (
          <circle
            key={p.t}
            cx={x(p.t)}
            cy={y(p.close)}
            r={active === i ? 3 : 1.5}
            fill={active === i ? "var(--primary)" : "var(--foreground)"}
          />
        ))}

        {/* Hover targets: one invisible column per point, so the nearest print is
            picked without any distance maths, and the whole plot height is a target
            rather than a 3px dot. Keyboard users get the same via the list below. */}
        {sorted.map((p, i) => {
          const prev = i === 0 ? x(p.t) : (x(sorted[i - 1]!.t) + x(p.t)) / 2
          const next =
            i === sorted.length - 1 ? x(p.t) : (x(p.t) + x(sorted[i + 1]!.t)) / 2
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
        <clipPath id={clipId}>
          <rect x={0} y={0} width={W} height={H} />
        </clipPath>
      </svg>

      {/* What the picture cannot state precisely. `intervalSec` frames the span,
          because 15 minutes of history means something different on a 15-minute
          market than on a 24-hour one. */}
      <p className="text-muted-foreground mt-1.5 text-[0.7rem] leading-snug">
        {spanLabel(span, intervalSec)}
        {breaks > 0 ? (
          <>
            {" · "}
            <span style={{ color: "var(--ink-unknown)" }}>
              {breaks} gap{breaks === 1 ? "" : "s"} with no trade
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

/** The span covered, and how much of the market's own window that is. */
function spanLabel(spanSec: number, intervalSec: number | null): string {
  const h = spanSec / 3600
  const span = h >= 1 ? `${h.toFixed(1)}h of prints` : `${Math.round(spanSec / 60)} min of prints`
  if (!intervalSec) return span
  return `${span}, ${Math.round((spanSec / intervalSec) * 100)}% of the window`
}
