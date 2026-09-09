import { Skeleton } from "@/components/ui/skeleton"

/**
 * The wait for ONE market, shaped like one market.
 *
 * WHY THIS FILE EXISTS. Next resolves `loading.tsx` from the nearest segment upward, so
 * until now clicking a row on the board fell through to `app/loading.tsx` — the BOARD
 * skeleton. Tapping a market produced the board's headline, the board's filter chips and
 * eight board rows, which is the shape of the page you just left. The transition read as
 * the same page reloading rather than a different one arriving, and on a phone, where the
 * old page scrolls away and nothing else signals a route change, that is the whole of the
 * feedback a tap gets.
 *
 * So the skeleton has to say "a market is coming", and it does that with the two things
 * only this route has: the back link, drawn for real because it is a fixed string and
 * works immediately, and the one-market header shape — a short asset name, a verdict
 * block, a confidence figure, a chart. Nothing here is eight of anything.
 *
 * The section headings are REAL TEXT, not bars. They are fixed strings that do not depend
 * on the read, so rendering them costs nothing and they tell a reader what is being
 * fetched rather than making them watch grey boxes. That is the same reasoning as the
 * board skeleton keeping its headline.
 *
 * AND THEY ARE IN THE PAGE'S ORDER. The page was reordered to answer before it argues
 * (before acting, then the deciding gate, then the book and the settlement, then the
 * signals); this shell was not, and a skeleton that lays its blocks out in one order while
 * the content arrives in another makes the reader watch the layout rearrange. The order
 * here tracks `page.tsx` exactly, and has to keep tracking it.
 *
 * Widths are chosen against the real page: an asset is 3-4 characters, a symbol and short
 * id run about 30, the headline is one line of display type and the summary two of body.
 * Wrong by a little costs a small settle; wrong by a lot looks like a different page.
 */
export default function Loading() {
  return (
    <>
      {/* Chrome is drawn for real. Only the read age is unknown at this point. */}
      <header className="border-border border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-x-4 px-6 py-3 sm:gap-x-6 sm:px-8">
          <span className="font-display text-lg leading-none tracking-tight">Fathom</span>
          <span className="text-muted-foreground hidden text-xs sm:inline">Somnia testnet</span>
          <div className="ml-auto flex items-center gap-x-4 sm:gap-x-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="size-7" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12 sm:px-8 sm:py-16">
        {/* Real, and already correct: it is the way back out of a page still loading. */}
        <span className="text-muted-foreground text-xs">← all markets</span>

        <header className="mt-6 border-b pb-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {/* The asset, at the size the real `h1` will be. */}
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="mt-2.5 h-3 w-56" />

          <div className="mt-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-8">
            {/* The verdict. The single most consequential thing on the page, so it holds
                the most space here too rather than being one bar among equals. */}
            <Skeleton className="h-9 w-36" />
            <div className="flex flex-wrap items-end gap-x-10 gap-y-8">
              <div>
                <p className="label-caps mb-1">confidence</p>
                <Skeleton className="h-7 w-14" />
                <Skeleton className="mt-2 h-3 w-44" />
              </div>
              {/* The price trace: a wide, short block, not a text bar. */}
              <div>
                <p className="label-caps mb-1.5">price</p>
                <Skeleton className="h-14 w-44" />
              </div>
            </div>
          </div>

          {/* The model's headline and summary. */}
          <Skeleton className="mt-8 h-5 w-full max-w-3xl" />
          <Skeleton className="mt-3 h-3 w-full max-w-3xl" />
          <Skeleton className="mt-2 h-3 w-2/3 max-w-3xl" />
        </header>

        {/* THE SHELL FOLLOWS THE PAGE'S ORDER, and that is not a detail: a skeleton whose
            blocks arrive in a different sequence than the content is worse than no
            skeleton, because the reader watches the layout rearrange itself. The page now
            answers before it argues — what to do, which gate stopped it, then the
            evidence — so the shell opens on those two headings rather than on the book. */}
        <section className="py-8">
          <h2 className="section-mark mb-4">Before acting</h2>
          <Skeleton className="h-3 w-full max-w-xl" />
          <Skeleton className="mt-2.5 h-3 w-2/3 max-w-xl" />
        </section>

        {/* The ladder: a rung is a mark and a line of text, so the shell draws that shape
            rather than plain bars. Four of the seven, for the same reason the signal
            skeleton draws four of eight — enough to read as a sequence without pretending
            to know how many gates this market reaches. */}
        <section className="pb-8">
          <h2 className="section-mark mb-4">Where the evaluation stopped</h2>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[1.25rem_1fr] gap-3 py-3">
              <Skeleton className="mt-1 size-1.5" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </section>

        {/* The two readings of the book. Headings real, figures pending. */}
        <section className="border-y py-8">
          <h2 className="section-mark mb-4">The book, as displayed</h2>
          <BookGrid />
          <h2 className="section-mark mt-8 mb-4">The same book, as owned</h2>
          <BookGrid />
        </section>

        <section className="border-b py-8">
          <h2 className="section-mark mb-3">Settlement</h2>
          <Skeleton className="h-3 w-full max-w-2xl" />
          <Skeleton className="mt-2 h-3 w-3/4 max-w-2xl" />
        </section>

        {/* The signals. Four rather than the board's eight: a market carries a handful of
            readings, and the count is what tells the two skeletons apart at a glance. */}
        <section className="py-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border-b py-5 first:pt-0">
              <div className="flex items-baseline justify-between gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="mt-3 h-3 w-full max-w-2xl" />
              <Skeleton className="mt-2 h-3 w-4/5 max-w-2xl" />
            </div>
          ))}
        </section>
      </main>
    </>
  )
}

/** Six figures, the shape both book readings take. */
function BookGrid() {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="h-2.5 w-12" />
          <Skeleton className="mt-2 h-4 w-16" />
        </div>
      ))}
    </div>
  )
}
