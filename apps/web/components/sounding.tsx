/**
 * The sounding line — Fathom's signature, and it is data-bound by construction.
 *
 * A fathom is a unit of depth, measured historically by dropping a weighted line
 * and reading how far it sank before finding bottom. That is literally what this
 * product does: it drops a line through a market and reports how deeply it could
 * see. So severity reads as depth of water rather than as a status colour.
 *
 * THE RULE THIS COMPONENT ENFORCES: every mark maps to a real measured value. No
 * tick exists for rhythm, no depth is chosen for balance. Specifically —
 *
 *   - the line's LENGTH is `confidence`, i.e. observational completeness
 *   - each signal's mark sits at a depth given by its measured severity
 *   - an `unknown` signal draws NO bottom mark, because the line never found
 *     one. That is the "unmeasured is not reassuring" invariant made visual: an
 *     absent reading looks absent, not clean.
 *
 * Rendered as CSS/SVG in document flow — no canvas, no physics, nothing that can
 * fail to paint and leave an empty panel.
 */

import { cn } from "@/lib/utils"

export type Severity = "ok" | "elevated" | "severe" | "unknown"

/**
 * How deep each severity sounds, as a fraction of the line.
 *
 * Ordered by how far a reader should have to look: `ok` resolves near the
 * surface, `severe` sinks. These are presentation depths for an ordinal scale,
 * not measurements pretending to be continuous.
 */
const DEPTH: Record<Severity, number> = {
  ok: 0.22,
  elevated: 0.58,
  severe: 0.92,
  unknown: 1,
}

const COLOR: Record<Severity, string> = {
  ok: "var(--sound-ok)",
  elevated: "var(--sound-elevated)",
  severe: "var(--sound-severe)",
  unknown: "var(--sound-unknown)",
}

export interface SoundingProps {
  signals: { id: string; label: string; severity: string }[]
  /** Observational completeness in [0,1] — the line's own reach. */
  confidence: number
  className?: string
}

/**
 * The full sounding: one column per signal, depth-marked, over a depth scale.
 *
 * Reads left to right in the engine's own evaluation order, so the visual matches
 * the rule order in the trace rather than being sorted for looks.
 */
export function Sounding({ signals, confidence, className }: SoundingProps) {
  const H = 64
  const W = Math.max(signals.length * 18, 40)
  const step = W / signals.length
  // The line reaches only as far as we could actually see.
  const reach = H * Math.max(0.12, Math.min(1, confidence))

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={`Sounding: ${signals.length} signals, confidence ${confidence}`}
    >
      {/* Surface — the datum every reading is measured from. */}
      <line x1={0} y1={1} x2={W} y2={1} stroke="var(--border)" strokeWidth={1} />

      {signals.map((s, i) => {
        const sev = (["ok", "elevated", "severe", "unknown"].includes(s.severity)
          ? s.severity
          : "unknown") as Severity
        const x = i * step + step / 2
        const y = Math.min(reach, H * DEPTH[sev])
        const found = sev !== "unknown"

        return (
          <g key={s.id}>
            {/* The line as far as it went. Dotted when it never found bottom. */}
            <line
              x1={x}
              y1={1}
              x2={x}
              y2={y}
              stroke={COLOR[sev]}
              strokeWidth={sev === "severe" ? 2 : 1.25}
              strokeDasharray={found ? undefined : "1.5 2"}
              opacity={found ? 1 : 0.7}
            />
            {/* Bottom mark. Present only when a depth was actually read. */}
            {found ? (
              <rect x={x - 2.5} y={y - 1.25} width={5} height={2.5} fill={COLOR[sev]} />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * A single signal's depth mark, for use inline in the signal table.
 *
 * Same encoding at a smaller scale so the list and the detail view read as one
 * system rather than two visualisations of the same thing.
 */
export function DepthMark({
  severity,
  className,
}: {
  severity: string
  className?: string
}) {
  const sev = (["ok", "elevated", "severe", "unknown"].includes(severity)
    ? severity
    : "unknown") as Severity
  const H = 22
  const y = H * DEPTH[sev]
  const found = sev !== "unknown"

  return (
    <svg
      viewBox={`0 0 8 ${H}`}
      width={8}
      height={H}
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <line
        x1={4}
        y1={0}
        x2={4}
        y2={y}
        stroke={COLOR[sev]}
        strokeWidth={sev === "severe" ? 2 : 1.25}
        strokeDasharray={found ? undefined : "1.5 2"}
        opacity={found ? 1 : 0.7}
      />
      {found ? <rect x={1} y={y - 1.25} width={6} height={2.5} fill={COLOR[sev]} /> : null}
    </svg>
  )
}

/** The severity word, in the depth palette. Never a pill. */
export function SeverityLabel({ severity }: { severity: string }) {
  const sev = (["ok", "elevated", "severe", "unknown"].includes(severity)
    ? severity
    : "unknown") as Severity
  return (
    <span className="label-caps" style={{ color: COLOR[sev] }}>
      {sev === "unknown" ? "no reading" : sev}
    </span>
  )
}
