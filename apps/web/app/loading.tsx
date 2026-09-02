import { Skeleton } from "@/components/ui/skeleton"

/**
 * The wait, shaped like the answer.
 *
 * A live pass is roughly 150 indexer round trips plus up to two model calls, so the
 * first load of this page can take tens of seconds. Until now it rendered nothing at
 * all for that whole window: a blank white screen with no indication that anything
 * was happening, which reads as broken rather than as busy. This is the single
 * largest gap in the interface, and it is not a spinner, because a spinner says "wait"
 * without saying what for.
 *
 * The skeleton matches the real layout row for row, so the page does not reflow when
 * the data lands and the shape of what is coming is legible while it is still coming.
 * Eight rows because eight is what this venue yields once windows under 15 minutes
 * are filtered out; wrong by one costs a small jump, wrong by five would look like a
 * different page.
 *
 * Nothing here animates beyond the primitive's own shimmer. A loading state that
 * pulses aggressively draws attention to the waiting rather than to the work.
 */
export default function Loading() {
  return (
    <>
      {/* The nav is static chrome, so it is drawn for real rather than skeletonised:
          the wordmark, the venue and the theme control do not depend on the read. */}
      <header className="border-border border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-x-6 px-6 py-3 sm:px-8">
          <span className="font-display text-lg leading-none tracking-tight">Fathom</span>
          <Skeleton className="h-3 w-40" />
          <div className="ml-auto flex items-center gap-x-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="size-7" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12 sm:px-8 sm:py-16">
        {/* The headline is a fixed string, not data. Showing it immediately means the
            page says what it IS while it works out what it knows. */}
        <header className="mb-10">
          <h1 className="font-display max-w-2xl text-3xl leading-tight">
            Every verdict here is computed in code.
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-relaxed">
            Reading the venue: order books, trades, oracle bindings and the resting book per
            order. This takes a moment on a cold read.
          </p>
        </header>

        {/* Filter chips, then the rows. */}
        <div className="mb-6 flex flex-wrap gap-1">
          {[3.5, 4.5, 5, 4.5, 6].map((w, i) => (
            <Skeleton key={i} className="h-6" style={{ width: `${w}rem` }} />
          ))}
        </div>

        <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_auto] items-end border-b pb-2">
          <span className="label-caps">market</span>
          <span className="label-caps text-right">verdict</span>
        </div>

        <ul>
          {Array.from({ length: 8 }).map((_, i) => (
            <li
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b py-4"
            >
              <div className="flex items-baseline gap-2.5">
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-3 w-8" />
              </div>
              <Skeleton className="h-4 w-20" />
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
