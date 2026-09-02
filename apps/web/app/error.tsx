"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"

/**
 * When the venue cannot be read at all.
 *
 * `getVenueRead` serves the last good snapshot on a failed pass, so this only fires
 * on a COLD cache: the process has never completed a read and the live one just
 * failed. That is an upstream outage, not a bug in the page, and the copy says so
 * rather than apologising vaguely.
 *
 * Three things it deliberately does:
 *
 * 1. NAMES WHAT FAILED, in the product's own terms. "Something went wrong" tells a
 *    reader nothing they can act on. The indexer being unreachable is a fact, and
 *    this product's entire stance is that a failed read gets reported as a failed
 *    read rather than rendered as a zero. An error page that hedges would contradict
 *    the engine it fronts.
 * 2. OFFERS THE RETRY, because the failure is usually transient: the Stage 2 notes
 *    measured roughly one indexer read in three failing on this network before the
 *    retry wrapper existed. `reset()` re-runs the segment without a full reload.
 * 3. POINTS AT THE FIXTURE. `FATHOM_FIXTURE=1` renders the frozen board with no
 *    network at all, which is the actual escape hatch on a bad network and is worth
 *    saying out loud rather than leaving in a commit message.
 *
 * No stack trace, no error code, no `digest`. Those belong in the server log; a
 * reader cannot use them and echoing a provider body is how an org id ends up on a
 * public page.
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col justify-center px-6 py-16 sm:px-8">
      <p className="label-caps mb-3">no read</p>
      <h1 className="font-display text-2xl leading-tight">The venue could not be read.</h1>
      <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
        No snapshot has completed yet, and the live read failed. Nothing is shown rather than
        showing figures that were never measured. This is usually transient: the indexer on this
        network drops roughly one read in three without a retry.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button onClick={reset}>Read again</Button>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-xs transition-colors"
        >
          back to all markets
        </Link>
      </div>

      <p className="text-muted-foreground mt-10 border-t pt-4 text-xs leading-relaxed">
        Running the dashboard from the frozen board needs no network:{" "}
        <span className="font-data">FATHOM_FIXTURE=1</span>.
      </p>
    </main>
  )
}
