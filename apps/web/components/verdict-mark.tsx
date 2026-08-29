/**
 * The verdict, rendered as a finding rather than a status badge.
 *
 * Deliberately not a pill: a coloured chip around a word is the component-kit
 * default, and it flattens ALLOW / RECHECK / BLOCK into the same visual weight as
 * a category tag. Here the verdict is the largest type on the row, set in the
 * display face, with the action stated underneath in plain words — the way a
 * report states a conclusion.
 */

import { cn } from "@/lib/utils"

type Verdict = "ALLOW" | "RECHECK" | "BLOCK"

const TONE: Record<Verdict, string> = {
  ALLOW: "var(--sound-ok)",
  RECHECK: "var(--sound-elevated)",
  BLOCK: "var(--sound-severe)",
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
  const scale = {
    sm: "text-sm",
    md: "text-xl",
    lg: "text-4xl sm:text-5xl",
  }[size]

  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      <span
        className={cn("font-display leading-none font-medium", scale)}
        style={{ color: TONE[v] }}
      >
        {v}
      </span>
      {size !== "sm" ? <span className="label-caps">{MEANS[v]}</span> : null}
    </span>
  )
}
