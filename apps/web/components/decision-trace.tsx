/**
 * The decision trace — the Stage 5 deliverable, rendered.
 *
 * Structured as an exhibit rather than a feed: for each signal, the measured
 * value, then the threshold that was applied and why THAT threshold on THIS
 * venue, then the model's plain reading. The calibration basis is the unusual
 * part and it is not tucked into a tooltip — a judge should be able to see that
 * a 2.6-point spread is called normal *because the venue's measured median is
 * 2.6*, not because someone picked a number.
 *
 * The rule path follows, in evaluation order, so the verdict is inspectable
 * rather than asserted. Then the explanation's provenance: model or fallback,
 * stated plainly, with the reason when it fell back.
 */

import { DepthMark, SeverityLabel } from "@/components/sounding"
import type { DecisionTrace } from "@fathom/core"

export function DecisionTraceView({ trace }: { trace: DecisionTrace }) {
  return (
    <div className="space-y-10">
      {/* ── signals ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="label-caps mb-4">signals · measured, thresholded, read</h2>
        <ul className="divide-y border-y">
          {trace.signals.map((s) => (
            <li key={s.id} className="grid grid-cols-[auto_1fr] gap-4 py-5">
              <DepthMark severity={s.severity} className="mt-1" />

              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="font-display text-base leading-none">{s.label}</h3>
                  <SeverityLabel severity={s.severity} />
                </div>

                {/* The finding: what was measured, in the engine's own words. */}
                <p className="text-sm leading-relaxed">{s.finding}</p>

                {/* The model's reading, clearly marked as the interpretive layer. */}
                {s.reading ? (
                  <p className="text-muted-foreground border-l-2 pl-3 text-sm leading-relaxed">
                    {s.reading}
                  </p>
                ) : null}

                {/* Evidence: the raw fields the finding was computed from. */}
                {Object.keys(s.evidence).length > 0 ? (
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                    {Object.entries(s.evidence)
                      .filter(([, v]) => v !== null && v !== undefined && v !== "")
                      .map(([k, v]) => (
                        <div key={k} className="flex items-baseline gap-1.5">
                          <dt className="label-caps">{k}</dt>
                          <dd className="font-data text-xs">
                            {typeof v === "string" && v.startsWith("http") ? "link" : String(v)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                ) : null}

                {/* Why this threshold, on this venue. The load-bearing line. */}
                <p className="text-muted-foreground/80 pt-1 text-xs leading-relaxed">
                  <span className="label-caps mr-1.5">basis</span>
                  {s.basis}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── the rule path ───────────────────────────────────────────────── */}
      <section>
        <h2 className="label-caps mb-4">why this verdict · rules in evaluation order</h2>
        <ol className="space-y-3">
          {trace.rules.map((r, i) => (
            <li key={`${r.rule}-${i}`} className="flex gap-3 text-sm">
              <span className="font-data text-muted-foreground shrink-0 text-xs">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <p className="font-data text-primary text-xs">{r.rule}</p>
                <p className="mt-0.5 leading-relaxed">{r.because}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── required checks ─────────────────────────────────────────────── */}
      {trace.requiredChecks.length > 0 ? (
        <section>
          <h2 className="label-caps mb-4">before acting</h2>
          <ul className="space-y-2">
            {trace.requiredChecks.map((c) => (
              <li key={c} className="flex gap-3 text-sm leading-relaxed">
                <span aria-hidden className="text-muted-foreground select-none">
                  ·
                </span>
                {c}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── explanation provenance ──────────────────────────────────────── */}
      <section className="border-t pt-6">
        <h2 className="label-caps mb-3">explanation</h2>
        <p className="text-sm leading-relaxed">
          {trace.explanation.source === "model" ? (
            <>
              Written by <span className="font-data">{trace.explanation.model}</span>, constrained
              to prose: its output schema has no verdict, confidence, or numeric field, so it
              cannot alter anything above.
            </>
          ) : (
            <>
              Written by the deterministic narrator, from the same signals. The model was not
              used.
            </>
          )}
        </p>
        {trace.explanation.fallbackReason ? (
          <p className="text-muted-foreground font-data mt-2 text-xs leading-relaxed">
            {trace.explanation.fallbackReason}
          </p>
        ) : null}
        {trace.explanation.usage ? (
          <p className="text-muted-foreground font-data mt-2 text-xs">
            {trace.explanation.usage.inputTokens} in · {trace.explanation.usage.outputTokens} out
          </p>
        ) : null}
      </section>
    </div>
  )
}
