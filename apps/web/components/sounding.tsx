/**
 * The sounding line: Fathom's signature, and data-bound by construction.
 *
 * A fathom is a unit of depth, measured historically by dropping a weighted line
 * and reading how far it sank before it found bottom. That is what this product
 * does. It drops a line through a market and reports how deeply it could see.
 *
 * THE RULE THIS COMPONENT ENFORCES: every mark maps to a measured value. No tick
 * exists for rhythm, no depth is chosen for balance. Specifically,
 *
 *   - the line's LENGTH is `confidence`, i.e. observational completeness
 *   - each signal's mark sits at a depth given by its measured severity
 *   - an `unknown` signal is dotted the whole way down and draws no bottom mark,
 *     because the line never found bottom. That is the "unmeasured is not
 *     reassuring" invariant made visual: an absent reading looks absent, not
 *     clean, and not like a rendering gap either.
 *
 * Severity is carried by SHAPE first, then ink density and stroke weight, never by
 * hue alone (see the ink scale in globals.css, and the note on `Mark` below for why
 * shape had to take over). So the chart is readable in greyscale, and a healthy
 * market genuinely looks quiet rather than reassuringly green.
 *
 * Rendered as SVG in document flow. No canvas, nothing that can fail to paint
 * and leave an empty panel, and no entrance animation gating its existence.
 */

import { cn } from "@/lib/utils"

export type Severity = "ok" | "elevated" | "severe" | "unknown"

const LEVELS = ["ok", "elevated", "severe", "unknown"] as const

const asSeverity = (v: string): Severity =>
  (LEVELS as readonly string[]).includes(v) ? (v as Severity) : "unknown"

/**
 * How deep each severity sounds, as a fraction of the line.
 *
 * Ordered by how far a reader should have to look before the finding resolves.
 * These are presentation depths for an ordinal scale, not measurements dressed up
 * as a continuum.
 */
const DEPTH: Record<Severity, number> = {
  ok: 0.18,
  elevated: 0.55,
  severe: 0.95,
  unknown: 1,
}

/** Ink, not colour. See the scale definition in globals.css. */
const INK: Record<Severity, string> = {
  ok: "var(--ink-ok)",
  elevated: "var(--ink-elevated)",
  severe: "var(--ink-severe)",
  unknown: "var(--ink-unknown)",
}

/** Stroke weight climbs with severity, so the ramp survives greyscale. */
const WEIGHT: Record<Severity, number> = {
  ok: 0.75,
  elevated: 1.25,
  severe: 2,
  unknown: 1,
}

/**
 * One sounding, drawn.
 *
 * THE RE-ENCODE, and why. The first version gave every severity the same shape,
 * a line with a foot, and varied only its depth and weight. Rendered at column
 * scale that produced a picket fence: five or six `ok` marks per row repeating
 * across the width, with the single severe descender that actually carries the
 * verdict competing against them. The stated intent in globals.css was that `ok`
 * is UNMARKED; it was drawing a 12px line plus a foot.
 *
 * So the four states are now four different SHAPES, and the shape does the work:
 *
 *   ok        a hairline, no foot. It resolves near the surface and stops. Nothing
 *             to report reads as nothing drawn, so a healthy row is quiet and the
 *             fence is gone.
 *   elevated  descends to mid-depth and finds bottom. A foot, because it resolved.
 *   severe    THE FRACTURE. Two segments that do not meet, laterally offset so the
 *             break is unmistakable at 16px. Borrowed from Debrief's understanding
 *             map, where needs-attention is a fractured member, and it means the
 *             right thing here: a market you can enter and not exit is a line that
 *             does not connect. It is the only broken shape on the page.
 *   unknown   dotted the whole way down, no foot, because the line never found
 *             bottom. Ends AT the frame rather than past it: the 4px overflow it
 *             used to carry landed on the row rule and read as a stray mark.
 */
function Mark({ sev, x, reach, H }: { sev: Severity; x: number; reach: number; H: number }) {
  const ink = INK[sev]
  const w = WEIGHT[sev]

  if (sev === "unknown") {
    return (
      <line
        x1={x}
        y1={0.5}
        x2={x}
        y2={H}
        stroke={ink}
        strokeWidth={w}
        strokeDasharray="1.5 2.5"
      />
    )
  }

  if (sev === "ok") {
    // No foot. A reading that found nothing worth reporting leaves the faintest
    // possible trace, which is the whole claim of the ink scale.
    return (
      <line x1={x} y1={0.5} x2={x} y2={Math.min(reach, H * DEPTH.ok)} stroke={ink} strokeWidth={w} />
    )
  }

  const y = Math.min(reach, H * DEPTH[sev])

  if (sev === "severe") {
    // The break sits proportionally, so it stays visible at any height.
    const breakTop = y * 0.46
    const breakBottom = y * 0.6
    const off = 1.75
    return (
      <g>
        <line x1={x - off} y1={0.5} x2={x - off} y2={breakTop} stroke={ink} strokeWidth={w} />
        <line x1={x + off} y1={breakBottom} x2={x + off} y2={y} stroke={ink} strokeWidth={w} />
        <rect x={x + off - 3.5} y={y - 1.5} width={7} height={3} fill={ink} />
      </g>
    )
  }

  return (
    <g>
      <line x1={x} y1={0.5} x2={x} y2={y} stroke={ink} strokeWidth={w} />
      <rect x={x - 2.5} y={y - 1} width={5} height={2} fill={ink} />
    </g>
  )
}

export interface SoundingProps {
  signals: { id: string; label: string; severity: string }[]
  /** Observational completeness in [0,1]: the line's own reach. */
  confidence: number
  className?: string
}

/**
 * The full sounding: one column per signal, depth-marked, over a depth scale.
 *
 * Reads left to right in the engine's own evaluation order, so the picture
 * matches the rule order in the trace rather than being sorted for looks.
 */
export function Sounding({ signals, confidence, className }: SoundingProps) {
  const H = 64
  const STEP = 16
  const W = Math.max(signals.length * STEP, 40)
  // The line reaches only as far as we could actually see.
  const reach = H * Math.max(0.12, Math.min(1, confidence))

  const worst = signals.reduce<Severity>((acc, s) => {
    const sev = asSeverity(s.severity)
    const rank: Record<Severity, number> = { ok: 0, unknown: 1, elevated: 2, severe: 3 }
    return rank[sev] > rank[acc] ? sev : acc
  }, "ok")

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={`Sounding across ${signals.length} signals. Worst reading ${worst}. Confidence ${confidence.toFixed(2)} of 1.`}
    >
      {/* The surface: the datum every reading is measured from. */}
      <line x1={0} y1={0.5} x2={W} y2={0.5} stroke="var(--border)" strokeWidth={1} />

      {signals.map((s, i) => (
        <Mark key={s.id} sev={asSeverity(s.severity)} x={i * STEP + STEP / 2} reach={reach} H={H} />
      ))}
    </svg>
  )
}

/**
 * One signal's depth mark, for use inline in the signal table.
 *
 * The same four shapes at a smaller scale, so the list and the detail view read as
 * one system rather than as two visualisations of the same thing. The fracture is
 * still legible here, which is the test the shape had to pass.
 */
export function DepthMark({
  severity,
  className,
}: {
  severity: string
  className?: string
}) {
  const H = 22
  return (
    <svg
      viewBox={`0 0 9 ${H}`}
      width={9}
      height={H}
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <Mark sev={asSeverity(severity)} x={4.5} reach={H} H={H} />
    </svg>
  )
}

/**
 * The severity word.
 *
 * Never a pill. A chip around a word is the component-kit default and it gives a
 * clean reading and a blocking one the same visual weight. It is also not a data
 * LABEL, so it does not wear the tracked-caps costume: it is a finding, and a
 * finding should read as a word. It carries its own ink instead. `ok` sits at the
 * page's quietest tone because a healthy signal has earned no emphasis, and
 * `severe` sits at full strength in the heavier weight.
 */
export function SeverityLabel({ severity }: { severity: string }) {
  const sev = asSeverity(severity)
  return (
    <span
      className={cn("text-xs", sev === "severe" && "font-medium")}
      style={{
        color:
          sev === "ok"
            ? "var(--muted-foreground)"
            : sev === "severe"
              ? "var(--ink-severe)"
              : INK[sev],
      }}
    >
      {sev === "unknown" ? "no reading" : sev}
    </span>
  )
}
