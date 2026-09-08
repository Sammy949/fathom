"use client"

import { useEffect, useState } from "react"

import { duration, NO_READING } from "@/lib/format"

/**
 * The market's own countdown, computed against the live clock.
 *
 * The board list has counted honestly since `dda18a7`; this figure had not, so the
 * SAME market read `past expiry 7m` in the table and `expires in 6m` on its own page.
 * Measured on the deployed site: `/m/017269` (BTC 16:30 window) was still offering a
 * six-minute countdown seven minutes after it settled, because the figure printed the
 * frozen `secToExpiry` straight off the board.
 *
 * A captured `secToExpiry` is a DELTA, not a fact that can be reprinted — the only
 * durable form is the absolute instant `assembledAt + secToExpiry`, compared against
 * now. That is the whole lesson of the countdown bug, and it applies per surface: the
 * list learning it did not teach this grid anything.
 *
 * When the window has closed the LABEL changes too, rather than leaving "expires in"
 * over a negative number. `duration` renders -646253 as `-7.5d`, which reads as a typo
 * rather than as a fact, and this page has no identity line to carry the lapse the way
 * a table row does — so the cell has to state it itself, in the severe ink the rest of
 * the page uses for a blocking finding.
 *
 * CONTENT IS NOT GATED ON THE EFFECT. The correct value renders on the server and again
 * on the first client paint; the interval only keeps it true afterwards. With JavaScript
 * off or throttled the figure is still there and still right for the moment it was
 * served. Same mechanism, and same reason, as ReadAge.
 */
export function ExpiresIn({
  assembledAt,
  secToExpiry,
}: {
  assembledAt: number
  secToExpiry: number | null | undefined
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  // A missing reading keeps the no-reading mark and the neutral label: absent is
  // not the same as expired, and collapsing the two would be the exact quiet wrong
  // answer this product exists to avoid.
  if (secToExpiry === null || secToExpiry === undefined) {
    return (
      <div>
        <p className="label-caps mb-1.5">expires in</p>
        <p className="font-data text-lg leading-none">{NO_READING}</p>
      </div>
    )
  }

  const remaining = Math.floor((assembledAt + secToExpiry * 1_000 - now) / 1_000)
  const expired = remaining <= 0

  return (
    <div>
      {/* The LABEL is suppressed too, not just the figure. A market can cross its
          expiry in the moment between the server render and hydration, and that flips
          the word as well as the number — the one hydration difference here that is a
          change of content rather than of a digit. */}
      <p className="label-caps mb-1.5" suppressHydrationWarning>
        {expired ? "past expiry" : "expires in"}
      </p>
      <p
        className="font-data text-lg leading-none"
        style={expired ? { color: "var(--ink-severe)" } : undefined}
        suppressHydrationWarning
      >
        {duration(expired ? -remaining : remaining)}
      </p>
    </div>
  )
}
