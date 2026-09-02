"use client"

import { useEffect, useState } from "react"

import { ago } from "@/lib/format"

/**
 * The age of the read, counting.
 *
 * Not decoration, and not motion for its own sake. This product's subject is
 * staleness: it grades markets on how long ago they last traded and caps
 * confidence on how completely they could be observed. A page that prints
 * "12s ago" and then holds that string for as long as the tab is open is itself
 * misreporting freshness, which is the one thing here that cannot be allowed to
 * drift. So the figure moves, because the fact it states is moving.
 *
 * CONTENT IS NOT GATED ON THE EFFECT. The correct value is rendered on the server
 * and again on the first client paint; the interval only keeps it true afterwards.
 * With JavaScript disabled, throttled, or broken, the number is still there and
 * still right for the moment the page was served. `suppressHydrationWarning`
 * covers the case where a second elapses between the server render and hydration,
 * which is a difference in the same fact rather than different content.
 */
export function ReadAge({ at, className }: { at: number; className?: string }) {
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1_000)
    return () => clearInterval(id)
  }, [])

  return (
    <span className={className} suppressHydrationWarning>
      {ago(at)}
    </span>
  )
}
