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

  // The book figures come off the liquidity signal's own evidence, so the header
  // and the trace below cannot disagree about what was measured.
  const liq = trace.signals.find((s) => s.id === "liquidity")
  const ev = (k: string) => {
    const v = liq?.evidence[k]
    return typeof v === "number" ? v : null
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:px-8 sm:py-16">
      <Link href="/" className="label-caps hover:text-foreground transition-colors">
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

      {/* ── the book, as measured ────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-x-8 gap-y-6 border-b py-8 sm:grid-cols-4 lg:grid-cols-6">
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
            label: "depth (thinner side)",
            value: shares(ev("thinnerSideShares")),
            unit: "sh",
          },
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
      </section>

      {/* ── trace + provenance ──────────────────────────────────────────── */}
      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <DecisionTraceView trace={trace} />

        <aside className="space-y-8 lg:sticky lg:top-8 lg:self-start">
          <Provenance entries={trace.provenance} />

          {trace.oracleAuditUrl ? (
            <div>
              <h3 className="label-caps mb-2">settlement receipt</h3>
              <a
                href={trace.oracleAuditUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary text-xs leading-relaxed underline decoration-1 underline-offset-2"
              >
                Oracle question: every price source, its value, the median, and how many had to
                agree
              </a>
            </div>
          ) : null}

          <div>
            <h3 className="label-caps mb-2">read</h3>
            <p className="font-data text-muted-foreground text-xs">{ago(trace.assembledAt)}</p>
          </div>

          {trace.unmeasured.length > 0 ? (
            <div>
              <h3 className="label-caps mb-2">no reading</h3>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {trace.unmeasured.join(", ")} could not be measured. Unmeasured is not the same as
                acceptable, which is why this market cannot be cleared for execution.
              </p>
            </div>
          ) : null}

          {row.lastTradeAgeSec !== null && row.intervalSec ? (
            <div>
              <h3 className="label-caps mb-2">last fill</h3>
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
