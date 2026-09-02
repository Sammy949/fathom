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
 *   - an `unknown` signal draws no bottom mark and its line RUNS OUT of the
 *     frame, because the line never found bottom. That is the "unmeasured is not
 *     reassuring" invariant made visual: an absent reading looks absent, not
 *     clean, and not like a rendering gap either.
 *
 * Severity is carried by INK DENSITY AND STROKE WEIGHT, not by hue (see the ink
 * scale in globals.css). `ok` is a hairline that barely marks the page; `severe`
 * is full-strength ink at double weight. So the chart is readable in greyscale,
 * and a healthy market genuinely looks quiet rather than reassuringly green.
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
  ok: 0.2,
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

      {signals.map((s, i) => {
        const sev = asSeverity(s.severity)
        const x = i * STEP + STEP / 2
        const found = sev !== "unknown"
        // A measured reading stops at its depth, capped by how far we could see.
        // An unmeasured one runs past the frame: it did not stop, it ran out.
        const y = found ? Math.min(reach, H * DEPTH[sev]) : H + 4

        return (
          <g key={s.id}>
            <line
              x1={x}
              y1={0.5}
              x2={x}
              y2={y}
              stroke={INK[sev]}
              strokeWidth={WEIGHT[sev]}
              strokeDasharray={found ? undefined : "1.5 2.5"}
            />
            {/* Bottom mark, present only where a depth was actually read. Its
                width grows with severity so the row scans by mass. */}
            {found ? (
              <rect
                x={x - (sev === "severe" ? 3.5 : 2.5)}
                y={y - (sev === "severe" ? 1.5 : 1)}
                width={sev === "severe" ? 7 : 5}
                height={sev === "severe" ? 3 : 2}
                fill={INK[sev]}
              />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * One signal's depth mark, for use inline in the signal table.
 *
 * The same encoding at a smaller scale, so the list and the detail view read as
 * one system rather than as two visualisations of the same thing.
 */
export function DepthMark({
  severity,
  className,
}: {
  severity: string
  className?: string
}) {
  const sev = asSeverity(severity)
  const H = 22
  const found = sev !== "unknown"
  const y = found ? H * DEPTH[sev] : H + 3

  return (
    <svg
      viewBox={`0 0 8 ${H}`}
      width={8}
      height={H}
      className={cn("shrink-0 overflow-visible", className)}
      aria-hidden
    >
      <line
        x1={4}
        y1={0}
        x2={4}
        y2={y}
        stroke={INK[sev]}
        strokeWidth={WEIGHT[sev]}
        strokeDasharray={found ? undefined : "1.5 2.5"}
      />
      {found ? (
        <rect
          x={sev === "severe" ? 0.5 : 1.5}
          y={y - (sev === "severe" ? 1.5 : 1)}
          width={sev === "severe" ? 7 : 5}
          height={sev === "severe" ? 3 : 2}
          fill={INK[sev]}
        />
      ) : null}
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
