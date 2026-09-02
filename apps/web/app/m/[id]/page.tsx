import Link from "next/link"
import { notFound } from "next/navigation"

import { DecisionTraceView } from "@/components/decision-trace"
import { Provenance } from "@/components/provenance"
import { Sounding } from "@/components/sounding"
import { VerdictMark } from "@/components/verdict-mark"
import { ago, duration, NO_READING, pct, points, prob, shares, windowLabel } from "@/lib/format"
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
  const trace = read.traces[id]
  const row = read.rows.find((r) => r.marketId === id)
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
    const v = trace.signals.find((s) => s.id === "resolution")?.evidence.oracleQuestionId
    return typeof v === "string" || typeof v === "number" ? String(v) : null
  })()

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:px-8 sm:py-16">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground text-xs transition-colors"
      >
        ← all markets
      </Link>

      {/* ── the finding ──────────────────────────────────────────────────── */}
      <header className="mt-6 border-b pb-8">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-display text-2xl leading-none">{row.asset ?? NO_READING}</h1>
          <span className="label-caps">{windowLabel(row.intervalSec)} window</span>
        </div>
        <p className="text-muted-foreground font-data mt-1.5 text-xs">{trace.symbol}</p>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-8">
          <div>
            <VerdictMark verdict={trace.verdict} size="lg" />
          </div>
          <div className="flex items-end gap-8">
            <div>
              <p className="label-caps mb-1">confidence</p>
              <p className="font-data text-2xl leading-none">{trace.confidence.toFixed(2)}</p>
              <p className="text-muted-foreground mt-1 max-w-[13rem] text-[0.7rem] leading-snug">
                how completely the market could be observed
              </p>
            </div>
            <Sounding
              signals={trace.signals.map((s) => ({
                id: s.id,
                label: s.label,
                severity: s.severity,
              }))}
              confidence={trace.confidence}
            />
          </div>
        </div>

        {/* The model's headline. Marked as prose, never as a number. */}
        <p className="font-display mt-8 max-w-3xl text-xl leading-snug">
          {trace.explanation.headline}
        </p>
        <p className="text-muted-foreground mt-3 max-w-3xl text-sm leading-relaxed">
          {trace.explanation.summary}
        </p>
      </header>

      {/* ── the book, in two readings ─────────────────────────────────────────
          Split deliberately, because the gap between them is the product. Every
          venue interface can show the top strip. Only a per-order chain read can
          show the bottom one, and on this venue the two describe very different
          books: a healthy-looking two-sided ladder that belongs to one address
          and expires in seconds. */}
      <section className="border-b py-8">
        <h2 className="section-mark mb-4">The book, as displayed</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "bid", value: prob(ev("bid")) },
            { label: "ask", value: prob(ev("ask")) },
            { label: "mid", value: prob(ev("mid")) },
            { label: "spread", value: points(ev("spreadPoints")), unit: "pt" },
            { label: "thinner side", value: shares(ev("thinnerSideShares")), unit: "sh" },
            { label: "expires in", value: duration(row.secToExpiry) },
          ].map((f) => (
            <div key={f.label}>
              <p className="label-caps mb-1.5">{f.label}</p>
              <p className="font-data text-lg leading-none">
                {f.value}
                {f.unit ? <span className="text-muted-foreground text-xs"> {f.unit}</span> : null}
              </p>
            </div>
          ))}
        </div>

        <h2 className="section-mark mt-8 mb-4">The same book, as owned</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "owners", value: dv("owners") === null ? NO_READING : String(dv("owners")) },
            { label: "largest owner", value: pct(dv("topOwnerShare")) },
            { label: "quote life", value: duration(dv("medianTtlSec")) },
            { label: "firm to expiry", value: pct(share(dv("firmShares"))) },
            { label: "pullable", value: pct(share(dv("pullableShares"))) },
            { label: "past expiry", value: pct(share(dv("phantomShares"))) },
          ].map((f) => (
            <div key={f.label}>
              <p className="label-caps mb-1.5">{f.label}</p>
              <p className="font-data text-lg leading-none">{f.value}</p>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground mt-5 max-w-2xl text-xs leading-relaxed">
          <span className="font-data">owner</span> and{" "}
          <span className="font-data">expireTimestampNs</span> exist per order on the chain read and
          are summed away by the materialized book, the indexer&apos;s rows, and every aggregated
          view. Firmness is only ever until an order&apos;s own expiry: the expired-order sweep is
          permissionless, so nothing here is a standing commitment.
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
            <span className="font-data">{oracleQuestionId ?? "unknown"}</span>. The audit trail is
            public: every price source, its value, the median, and how many had to agree.
          </p>
          <a
            href={trace.oracleAuditUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary font-data mt-2 inline-block text-xs underline decoration-1 underline-offset-2"
          >
            open the settlement receipt
          </a>
        </section>
      ) : null}

      {/* ── trace + provenance ──────────────────────────────────────────── */}
      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <DecisionTraceView trace={trace} />

        <aside className="space-y-8 lg:sticky lg:top-8 lg:self-start">
          <Provenance entries={trace.provenance} />

          <div>
            <h3 className="section-mark mb-2">Read</h3>
            <p className="font-data text-muted-foreground text-xs">{ago(trace.assembledAt)}</p>
          </div>

          {trace.unmeasured.length > 0 ? (
            <div>
              <h3 className="section-mark mb-2">No reading</h3>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {trace.unmeasured.join(", ")} could not be measured. Unmeasured is not the same as
                acceptable, which is why this market cannot be cleared for execution.
              </p>
            </div>
          ) : null}

          {row.lastTradeAgeSec !== null && row.intervalSec ? (
            <div>
              <h3 className="section-mark mb-2">Last fill</h3>
              <p className="font-data text-sm">{duration(row.lastTradeAgeSec)}</p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {pct(row.lastTradeAgeSec / row.intervalSec)} of this market&apos;s own window,
                the only comparable measure across a venue running 15m to 24h series
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  )
}
