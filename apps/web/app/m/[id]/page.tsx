import Link from "next/link"
import { notFound } from "next/navigation"

import {
  ExplanationSource,
  RequiredChecks,
  SignalTable,
} from "@/components/decision-trace"
import { ExpiresIn } from "@/components/expires-in"
import { GateLadder } from "@/components/gate-ladder"
import { PriceTrace } from "@/components/price-trace"
import { ProvenanceSheet } from "@/components/provenance"
import { SiteNav } from "@/components/site-nav"
import { VerdictMark } from "@/components/verdict-mark"
import {
  duration,
  isResolvableMarketId,
  NO_READING,
  pct,
  points,
  prob,
  shares,
  shortId,
  windowLabel,
} from "@/lib/format"
import { getVenueRead } from "@/lib/venue"

// Per-request for the same reason as the index — see app/page.tsx.
export const dynamic = "force-dynamic"

export default async function MarketPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const read = await getVenueRead()

  /**
   * Accepts the SHORT id, and still accepts the full one.
   *
   * A market id is a bytes32, so the route used to read
   * `/m/0x0000000000000000000000000000000000000000000000000000000000010fad`:
   * 66 characters of which 61 are zero padding, unreadable in a browser bar and
   * impossible to say out loud. The venue's own symbols suffix markets by their low
   * bytes for exactly this reason, so the links now carry the same six characters
   * (`/m/010fad`) and the page resolves by suffix.
   *
   * Resolution is strict about ambiguity rather than picking the first hit: a suffix
   * that matches two live markets resolves to neither, because guessing which market
   * a trader meant is precisely the class of quiet wrong answer this product exists
   * to avoid. Full ids keep working, so any link already shared still opens.
   *
   * It is also strict about SHAPE, for the same reason one step earlier. Suffix matching
   * accepts any string, so an unvalidated one-character id resolved whenever exactly one
   * market on the board ended in it — five of seven, measured. That is not an identifier:
   * the board rolls on fixed windows, so the same string names a different market tomorrow
   * and the page would render a confident verdict for it. `isResolvableMarketId` is shared
   * with `/api/markets/[id]` so a person and an agent resolve a string identically.
   */
  if (!isResolvableMarketId(id)) notFound()

  const wanted = id.toLowerCase()
  const matches = read.rows.filter((r) => {
    const full = r.marketId.toLowerCase()
    return full === wanted || full.endsWith(wanted)
  })
  const row = matches.length === 1 ? matches[0] : undefined
  const trace = row ? read.traces[row.marketId] : undefined
  if (!trace || !row) notFound()

  // Figures come off the signals' own evidence, so the header and the trace below
  // cannot disagree about what was measured.
  const evidenceOf = (id: string) => {
    const sig = trace.signals.find((s) => s.id === id)
    return (k: string) => {
      const v = sig?.evidence[k]
      return typeof v === "number" ? v : null
    }
  }
  const ev = evidenceOf("liquidity")
  const dv = evidenceOf("depth")
  const displayed = dv("totalShares")
  /** A share bucket as a fraction of displayed depth, or null if we cannot say. */
  const share = (n: number | null) =>
    n === null || displayed === null || displayed <= 0 ? null : n / displayed

  // Read off the resolution signal's evidence rather than re-deriving, so the
  // settlement block and the trace name the same question.
  const oracleQuestionId = (() => {
    const v = trace.signals.find((s) => s.id === "resolution")?.evidence
      .oracleQuestionId
    return typeof v === "string" || typeof v === "number" ? String(v) : null
  })()

  return (
    <>
      <SiteNav network="Somnia testnet" assembledAt={trace.assembledAt} />
      <main className="mx-auto max-w-5xl px-6 py-12 sm:px-8 sm:py-16">
        <Link
          href="/"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ← all markets
        </Link>

        {/* ── the finding ──────────────────────────────────────────────────── */}
        <header className="mt-6 border-b pb-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-display text-2xl leading-none">
              {row.asset ?? NO_READING}
            </h1>
            {/* A figure, so it is set as data — see the note in market-list. */}
            <span className="font-data text-xs text-muted-foreground">
              {windowLabel(row.intervalSec)} window
            </span>
          </div>
          {/* The reference strings, together, and only here. They came off the list
            row: a symbol nobody parses and a 66-character id are identity for a
            market you have already chosen, not information that helps you choose
            one. This is where a reader looks them up. */}
          <p className="font-data mt-1.5 text-xs text-muted-foreground">
            {trace.symbol} · {shortId(row.marketId)}
          </p>

          <div className="mt-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-8">
            <div>
              <VerdictMark verdict={trace.verdict} size="lg" />
            </div>
            <div className="flex flex-wrap items-end gap-x-10 gap-y-8">
              <div>
                <p className="label-caps mb-1">confidence</p>
                <p className="font-data text-2xl leading-none">
                  {trace.confidence.toFixed(2)}
                </p>
                <p className="mt-1 max-w-[13rem] text-[0.7rem] leading-snug text-muted-foreground">
                  how completely the market could be observed
                </p>
              </div>
              {/* The sounding used to sit here. It was a third encoding of information
                the gate ladder and the signal table both carry further down, in the
                one slot where a trader looks for the market's own price history and
                never found it. */}
              {/* No `insufficientNote`: it used to be handed the volatility signal's
                  finding, so the exact sentence "Only 1 price bucket exists, fewer than
                  the 3 needed to judge a move" printed twice on the same page, once in
                  this chart slot and once in the Volatility signal. The chart says only
                  that it cannot draw; the reason belongs to the signal that measured it. */}
              <PriceTrace
                points={trace.prices}
                intervalSec={row.intervalSec}
                assembledAt={trace.assembledAt}
              />
            </div>
          </div>

          {/* The model's headline. Marked as prose, never as a number. */}
          <p className="mt-8 max-w-3xl font-display text-xl leading-snug">
            {trace.explanation.headline}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {trace.explanation.summary}
          </p>
        </header>

        {/* ── the audit spine ──────────────────────────────────────────────────
            ORDER IS THE ARGUMENT, and this is its second correction. The page once
            ran signals-first, which put the blocks a trader can act on furthest from
            the top; that was fixed. What remained was subtler: the book and the
            settlement note still sat between the verdict and the reasoning, so
            "Before acting" — the only block that tells a reader what to DO — landed
            tenth on the page, below two sections of evidence for a claim it had not
            made yet.

            So the spine now runs answer, then reasoning, then evidence:
            verdict (header) → what must be true before acting → what could not be
            measured → which gate stopped it → the book in two readings → how it
            settles → the eight signals → how we know.

            Everything sits in one column at full measure. The 14rem sticky rail that
            used to hold provenance was content flung to the far edge with a gulf in
            the middle; provenance is machinery, so it moved into a sheet at the foot
            of the page. */}
        <div className="mt-10 space-y-12">
          <RequiredChecks trace={trace} />

          {/* WHICH SIGNALS COULD NOT BE READ, on the pages where the ladder does not
              already say so.

              Measured across the board: 5 of 8 markets stop at the `incomplete-observation`
              gate, and there the ladder prints the engine's own "2 signals could not be
              measured (volatility, manipulation), so this cannot be cleared for execution"
              two inches below this section, which said the same thing in different words.
              On the market that stopped at a severe signal instead, the unmeasured ones are
              a real qualification nothing else states, and it renders.

              The rule id is matched here as well as in the ladder, which is a small
              duplication accepted deliberately: the alternative is passing render state
              between two sections that are otherwise independent. */}
          {trace.unmeasured.length > 0 &&
          trace.rules[0]?.rule !== "incomplete-observation" ? (
            <section>
              <h2 className="section-mark mb-3">Not measured</h2>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {trace.unmeasured.join(", ")} could not be read. Unmeasured is
                not the same as acceptable, which is why this market cannot be
                cleared for execution.
              </p>
            </section>
          ) : null}

          {/* The gate ladder replaces the numbered rule list. Same information, minus
              the raw rule ids that list printed in mono, and it shows the one thing
              nothing else did: which checks were never reached because an earlier gate
              already decided. */}
          <GateLadder trace={trace} />
        </div>

        {/* ── the book, in two readings ─────────────────────────────────────────
          Split deliberately, because the gap between them is the product. Every
          venue interface can show the top strip. Only a per-order chain read can
          show the bottom one, and on this venue the two describe very different
          books: a healthy-looking two-sided ladder that belongs to one address
          and expires in seconds.

          `border-t` is new: this block used to sit directly under the header and
          borrowed its bottom rule. It now opens the evidence half of the page, after
          the ladder, so it draws its own. */}
        <section className="border-y py-8">
          <h2 className="section-mark mb-4">The book, as displayed</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "bid", value: prob(ev("bid")) },
              { label: "ask", value: prob(ev("ask")) },
              { label: "mid", value: prob(ev("mid")) },
              {
                label: "spread",
                value: points(ev("spreadPoints")),
                unit: "pt",
              },
              {
                label: "thinner side",
                value: shares(ev("thinnerSideShares")),
                unit: "sh",
              },
            ].map((f) => (
              <div key={f.label}>
                <p className="label-caps mb-1.5">{f.label}</p>
                <p className="font-data text-lg leading-none">
                  {f.value}
                  {f.unit ? (
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      {f.unit}
                    </span>
                  ) : null}
                </p>
              </div>
            ))}
            {/* Last cell, same shape as the five above, but it owns its own label:
                a closed window has to change the words, not just the number. See
                ExpiresIn — the countdown counts against the live clock rather than
                reprinting the delta frozen into the board at capture. */}
            <ExpiresIn
              assembledAt={trace.assembledAt}
              secToExpiry={row.secToExpiry}
            />
          </div>

          <h2 className="section-mark mt-8 mb-4">The same book, as owned</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
            {[
              {
                label: "owners",
                value:
                  dv("owners") === null ? NO_READING : String(dv("owners")),
              },
              { label: "largest owner", value: pct(dv("topOwnerShare")) },
              { label: "quote life", value: duration(dv("medianTtlSec")) },
              { label: "firm to expiry", value: pct(share(dv("firmShares"))) },
              { label: "pullable", value: pct(share(dv("pullableShares"))) },
              // NOT "past expiry", which is what this said. Two cells five centimetres
              // apart both read `past expiry` and meant different things: in the displayed
              // book it is how long ago the MARKET's window closed (`8h`), here it is the
              // share of displayed DEPTH resting on orders that have already lapsed (`0%`).
              // One label, one meaning. "expired depth" also sits in the same family as
              // `firm to expiry` and `pullable`, which are the other two ways this same
              // pool of shares is described.
              { label: "expired depth", value: pct(share(dv("phantomShares"))) },
            ].map((f) => (
              <div key={f.label}>
                <p className="label-caps mb-1.5">{f.label}</p>
                <p className="font-data text-lg leading-none">{f.value}</p>
              </div>
            ))}
          </div>
          {/* WHY THIS BLOCK EXISTS, in one sentence rather than three. The cut
              dropped "the materialized book, the indexer's rows, and every
              aggregated view" to just the last of those — three names for the same
              fact, two of which are this codebase's vocabulary rather than the
              reader's. The two field names stay: they are the proof that this is a
              per-order chain read and not a nicer rendering of the same summary
              every other interface shows. */}
          <p className="mt-5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            <span className="font-data">owner</span> and{" "}
            <span className="font-data">expireTimestampNs</span> exist per order on
            the chain read, and every aggregated view sums them away. Firmness runs
            only to an order&apos;s own expiry, so nothing here is a standing
            commitment.
          </p>
        </section>

        {/* ── settlement, stated before the trace ───────────────────────────────
          Placed here rather than in a sidebar because how a contract resolves is
          the most consequential thing on the page: a market can be perfectly
          liquid and still pay both sides 0.5 if the window lapses. Naming the
          oracle and linking the audit trail is also the cheapest credibility this
          product has, and it should not be a footnote. */}
        {trace.oracleAuditUrl ? (
          <section className="border-b py-8">
            <h2 className="section-mark mb-3">Settlement</h2>
            <p className="max-w-2xl text-sm leading-relaxed">
              This market settles from oracle question{" "}
              <span className="font-data">{oracleQuestionId ?? "unknown"}</span>
              . The audit trail is public: every price source, its value, the
              median, and how many had to agree.
            </p>
            <a
              href={trace.oracleAuditUrl}
              target="_blank"
              rel="noreferrer"
              className="font-data mt-2 inline-block text-xs text-primary underline decoration-1 underline-offset-2"
            >
              open the settlement receipt
            </a>
          </section>
        ) : null}

        <div className="mt-12 space-y-12">
          <SignalTable trace={trace} />

          {/* How we know, last: the explanation's provenance, then the per-field
              read provenance behind a sheet. */}
          <section className="space-y-4 border-t pt-8">
            <ExplanationSource trace={trace} />
            <ProvenanceSheet entries={trace.provenance} />
          </section>
        </div>
      </main>
    </>
  )
}
