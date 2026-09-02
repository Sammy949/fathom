/**
 * The verdict, rendered as a finding rather than as a status badge.
 *
 * Not a pill: a coloured chip around a word is the component-kit default, and it
 * flattens ALLOW / RECHECK / BLOCK into the same visual weight as a category tag.
 * Here the verdict is the largest type in its row, set in the display face, with
 * what it permits stated underneath in plain words, the way a report states a
 * conclusion.
 *
 * COLOUR HERE, INK EVERYWHERE ELSE, and the line between them is the point. A
 * verdict is a DECISION, and green/amber/red is the one convention that reads a
 * decision correctly at a glance in any culture that drives. A signal severity is
 * a READING, and green on a reading would claim "fine" about a measurement that
 * may never have been taken. So the traffic light stops at this component: the
 * eight signals keep the ink ramp, where `unknown` is a different shape rather
 * than a reassuring colour.
 *
 * Weight still carries rank independently of hue, so the row scans in greyscale
 * and for the ~8% of men who will not reliably separate the green from the red:
 * ALLOW is light, RECHECK regular, BLOCK bold, and only BLOCK gets the heaviest
 * weight Zodiak carries.
 */

import { cn } from "@/lib/utils"

type Verdict = "ALLOW" | "RECHECK" | "BLOCK"

/** Hue states the decision, weight states its force. Neither carries it alone. */
const INK: Record<Verdict, { color: string; weight: string }> = {
  ALLOW: { color: "var(--verdict-allow)", weight: "font-light" },
  RECHECK: { color: "var(--verdict-recheck)", weight: "font-normal" },
  BLOCK: { color: "var(--verdict-block)", weight: "font-bold" },
}

/** What the verdict actually permits, in words a trader can act on. */
const MEANS: Record<Verdict, string> = {
  ALLOW: "may execute",
  RECHECK: "confirm first",
  BLOCK: "do not execute",
}

export function VerdictMark({
  verdict,
  size = "md",
  className,
}: {
  verdict: string
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const v = (["ALLOW", "RECHECK", "BLOCK"].includes(verdict) ? verdict : "RECHECK") as Verdict
  const ink = INK[v]
  const scale = {
    sm: "text-sm",
    md: "text-xl",
    lg: "text-4xl sm:text-5xl",
  }[size]

  return (
    <span className={cn("inline-flex flex-col gap-1", className)}>
      <span
        className={cn("font-display leading-none", scale, ink.weight)}
        style={{ color: ink.color }}
      >
        {v}
      </span>
      {size !== "sm" ? (
        <span className="text-muted-foreground text-xs">{MEANS[v]}</span>
      ) : null}
    </span>
  )
}
