import { MarketList } from "@/components/market-list"
import { ago, shortId } from "@/lib/format"
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
    <main className="mx-auto max-w-5xl px-6 py-12 sm:px-8 sm:py-16">
      {/* Masthead. An exhibit header, not a marketing hero: what this is, what it
          measured, and when. No eyebrow pill, no CTA pair. */}
      <header className="mb-12">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-display text-3xl leading-none">Fathom</h1>
          <span className="label-caps">DreamDEX event contracts · Somnia testnet</span>
        </div>
        <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-relaxed">
          Every verdict below is computed in code from measured order-book, trade and oracle
          state. A language model writes the explanations and cannot change a verdict: its
          output schema has no field for one.
        </p>

        <dl className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t pt-4">
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
          <div className="flex items-baseline gap-2">
            <dt className="label-caps">read</dt>
            <dd className="font-data text-muted-foreground text-sm">{ago(read.assembledAt)}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="label-caps">venue</dt>
            <dd className="font-data text-muted-foreground text-sm">{shortId(read.venueId)}</dd>
          </div>
        </dl>
      </header>

      <MarketList rows={read.rows} />

      {/* Ingest failures are shown, not swallowed. A market the indexer listed
          but that could not be snapshotted is a fact about the read. */}
      {read.failures.length > 0 ? (
        <section className="mt-10 border-t pt-6">
          <h2 className="label-caps mb-3">not assessed</h2>
          <ul className="space-y-1.5">
            {read.failures.map((f) => (
              <li key={f.marketId} className="font-data text-muted-foreground text-xs">
                {shortId(f.marketId)} · {f.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="text-muted-foreground mt-16 border-t pt-6 text-xs leading-relaxed">
        Thresholds are calibrated to this venue&apos;s measured distributions, not to real-money
        market intuitions. Spreads of 2 to 3 probability points are normal here. Confidence
        measures how completely a market could be observed; it is never a probability of any
        outcome.
      </footer>
    </main>
  )
}
