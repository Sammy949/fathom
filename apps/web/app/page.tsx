import { MarketList } from "@/components/market-list"
import { SiteNav } from "@/components/site-nav"
import { shortId } from "@/lib/format"
import { getVenueRead } from "@/lib/venue"

/**
 * Rendered per request, never prerendered.
 *
 * The indexer reads are deliberately `cache: "no-store"` — a stale order book
 * must never feed a risk verdict — so a static prerender is not just wrong here,
 * it fails the build outright ("couldn't be rendered statically because it used
 * no-store fetch"). Freshness is bounded by the 45s in-memory TTL in
 * `lib/venue.ts` instead, and the masthead states when the read was taken.
 */
export const dynamic = "force-dynamic"

export default async function Home() {
  const read = await getVenueRead()
  const tally = read.rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1
    return acc
  }, {})

  return (
    <>
      <SiteNav
        venueId={read.venueId}
        network="Somnia testnet"
        assembledAt={read.assembledAt}
      />
      <main className="mx-auto max-w-5xl px-6 py-12 sm:px-8 sm:py-16">
        {/* The opening statement, not a marketing hero. Split into a headline and
            one line of deck rather than a 35-word paragraph: the claim is short
            enough to be a sentence, and identity, venue and read age now live in
            the nav instead of being said twice. */}
        <header className="mb-12">
          <h1 className="font-display max-w-2xl text-3xl leading-tight">
            Every verdict here is computed in code.
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-relaxed">
            A language model writes the explanations and cannot change a verdict: its output
            schema has no field for one.
          </p>

          <dl className="mt-8 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t pt-4">
            <div className="flex items-baseline gap-2">
              <dt className="label-caps">assessed</dt>
              <dd className="font-data text-sm">{read.rows.length}</dd>
            </div>
            {(["ALLOW", "RECHECK", "BLOCK"] as const).map((v) => (
              <div key={v} className="flex items-baseline gap-2">
                <dt className="label-caps">{v.toLowerCase()}</dt>
                <dd className="font-data text-sm">{tally[v] ?? 0}</dd>
              </div>
            ))}
          </dl>
        </header>

        <MarketList rows={read.rows} />

        {/* Ingest failures are shown, not swallowed. A market the indexer listed
            but that could not be snapshotted is a fact about the read. */}
        {read.failures.length > 0 ? (
          <section className="mt-16">
            <h2 className="section-mark mb-3">Not assessed</h2>
            <ul className="space-y-1.5">
              {read.failures.map((f) => (
                <li key={f.marketId} className="font-data text-muted-foreground text-xs">
                  {shortId(f.marketId)} · {f.reason}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* One note, not two. The previous pair said the same thing twice: that
            thresholds are venue-calibrated, and that severity is ink rather than a
            traffic light. Both are true; the second only restated the first in
            different words, and a reader who has scrolled the table does not need
            the premise explained again. Rules dropped in favour of a gap. */}
        <footer className="text-muted-foreground mt-20 max-w-2xl text-xs leading-relaxed">
          Thresholds are calibrated to this venue&apos;s measured distributions, not to real-money
          market intuitions. Spreads of 2 to 3 probability points are normal here, and so is a
          resting book that expires in twenty seconds. Confidence measures how completely a market
          could be observed, never how likely an outcome is.
        </footer>
      </main>
    </>
  )
}
