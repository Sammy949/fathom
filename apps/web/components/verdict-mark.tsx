/**
 * The verdict, rendered as a finding rather than as a status badge.
 *
 * Not a pill: a coloured chip around a word is the component-kit default, and it
 * flattens ALLOW / RECHECK / BLOCK into the same visual weight as a category tag.
 * Here the verdict is the largest type in its row, set in the display face, with
 * what it permits stated underneath in plain words, the way a report states a
 * conclusion.
 *
 * SEVERITY IS INK, NOT HUE, and that shapes what ALLOW looks like. ALLOW gets the
 * page's quietest tone at the lightest weight, because a market with nothing wrong
 * with it has earned no emphasis. RECHECK gets the single warning amber. BLOCK
 * gets full-strength ink at the heaviest weight Zodiak carries. So a board of
 * healthy markets reads calm, and one BLOCK is the loudest thing on the screen
 * without a red pill anywhere in sight.
 */

import { cn } from "@/lib/utils"

type Verdict = "ALLOW" | "RECHECK" | "BLOCK"

/** Ink weight and depth per verdict. Colour does none of the ranking alone. */
const INK: Record<Verdict, { color: string; weight: string }> = {
  ALLOW: { color: "var(--muted-foreground)", weight: "font-light" },
  RECHECK: { color: "var(--ink-elevated)", weight: "font-normal" },
  BLOCK: { color: "var(--ink-severe)", weight: "font-bold" },
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
