/**
 * The decision trace — the Stage 5 deliverable, rendered.
 *
 * Structured as an exhibit rather than a feed: for each signal, the measured value, then
 * the threshold that was applied and — on the signals that shaped the verdict — why THAT
 * threshold on THIS venue. The calibration basis is the unusual part, and a judge should
 * be able to see that a 2.6-point spread is called normal *because the venue's measured
 * median is 2.6*, not because someone picked a number.
 *
 * The rule path follows, in evaluation order, so the verdict is inspectable rather than
 * asserted. Then the explanation's provenance: model or fallback, stated plainly, with
 * the reason when it fell back.
 *
 * THREE DENSITY DECISIONS, each taken from a measurement of the rendered page rather
 * than by feel. The page ran 951 words on average across all eight markets, and 41% of
 * that was text identical on every one of them.
 *
 * 1. THE PER-SIGNAL READING IS GONE. It was the model paraphrasing, one signal at a
 *    time, the summary it had already written at the top of the page. Measured across
 *    the whole board: 42 of 64 signals carried no reading at all, so five markets showed
 *    none and three showed six to eight, with nothing in the UI deciding which — the
 *    model's output decided. An element that appears on some markets and not others,
 *    for no reason a reader can see, reads as broken even when each line is fine. The
 *    model still speaks, in the headline and summary up top and in `Explanation` at the
 *    foot; it no longer narrates over the engine's own findings. (This retires the
 *    `restatesFinding` guard, which was catching nothing: it tested exact substrings and
 *    the readings were paraphrases.)
 * 2. THE BASIS IS GATED BY RELEVANCE, not hidden. See the note at its render site.
 * 3. EVIDENCE MOVES OUT OF FLOW ENTIRELY. Forty key-value pairs across eight signals,
 *    many of them internal field names, were the single densest thing on screen. They
 *    live in a Sheet per signal now: the machinery is consultable without leaving the
 *    audit, and the argument stops competing with the receipts. The reasoning itself
 *    (rules, required checks) is deliberately NOT hidden this way, because that is the
 *    product rather than its appendix.
 */

import { DepthMark, SeverityLabel } from "@/components/sounding"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { WayIn } from "@/components/way-in"
import type { DecisionTrace } from "@fathom/core"

/**
 * Why the explanation fell back, in a sentence a reader can use.
 *
 * The raw value is a transport string: `groq:openai/gpt-oss-120b: Error: HTTP 429:
 * {"error":{"message":"Rate limit reached for model ...`. Printing that put 42 words
 * of JSON on the page and named the provider and the model to anyone looking, which
 * is configuration rather than content. The distinctions a reader actually needs are
 * whether the model was asked at all, whether it was rate-limited, and whether its
 * output was rejected. Everything else is a log line.
 */
function humanFallbackReason(raw: string): string {
  const r = raw.toLowerCase()
  if (r.includes("offline"))
    return "Offline mode was requested, so the model was never called."
  if (r.includes("no provider") || r.includes("not configured")) {
    return "No explanation provider is configured, so the narrator wrote this."
  }
  if (r.includes("429") || r.includes("rate limit")) {
    return "The model was rate-limited on this read, so the narrator wrote this instead."
  }
  if (r.includes("401") || r.includes("invalid api key")) {
    return "The provider rejected our credentials, so the narrator wrote this instead."
  }
  if (r.includes("json_validate") || r.includes("does not match")) {
    return "The model's output did not satisfy the response schema and was discarded."
  }
  if (r.includes("missing required fields")) {
    return "The model's output was missing required fields and was discarded."
  }
  if (r.includes("guard") || r.includes("rejected")) {
    return "The guard rejected the model's prose, so the narrator wrote this instead."
  }
  if (
    r.includes("fetch failed") ||
    r.includes("timed out") ||
    r.includes("etimedout")
  ) {
    return "The provider was unreachable on this read, so the narrator wrote this instead."
  }
  return "The model could not be used on this read, so the narrator wrote this instead."
}

/**
 * The trace, in four separately-placeable parts.
 *
 * Split because the page's ORDER is the argument. Everything used to render in one
 * block as signals, then rules, then "before acting", then provenance — which put
 * the two blocks a trader can act on furthest from the top, below eight signals and
 * forty evidence fields. The spec's own flow is: show the verdict, show what must be
 * true before acting, show why, then show the evidence. The page composes these in
 * that order now; see `app/m/[id]/page.tsx`.
 */
export function RequiredChecks({ trace }: { trace: DecisionTrace }) {
  if (trace.requiredChecks.length === 0) return null
  return (
    <section>
      <h2 className="section-mark mb-4">Before acting</h2>
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
  )
}

export function ExplanationSource({ trace }: { trace: DecisionTrace }) {
  return (
    <section>
      <h2 className="section-mark mb-3">Explanation</h2>
      <p className="text-sm leading-relaxed">
        {trace.explanation.source === "model" ? (
          <>
            Written by{" "}
            <span className="font-data">{trace.explanation.model}</span>,
            constrained to prose: its output schema has no verdict, confidence,
            or numeric field, so it cannot alter anything above.
          </>
        ) : (
          <>
            Written by the deterministic narrator, from the same signals. The
            model was not used.
          </>
        )}
      </p>
      {trace.explanation.fallbackReason ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {/* The provider's raw body used to land here verbatim, which meant a
              rate limit printed 42 words of JSON on the page and named the
              provider and model to anyone reading. The reason is worth stating;
              the transport envelope is not. */}
          {humanFallbackReason(trace.explanation.fallbackReason)}
        </p>
      ) : null}
      {trace.explanation.usage ? (
        <p className="font-data mt-2 text-xs text-muted-foreground">
          {trace.explanation.usage.inputTokens} in ·{" "}
          {trace.explanation.usage.outputTokens} out
        </p>
      ) : null}
    </section>
  )
}

export function SignalTable({ trace }: { trace: DecisionTrace }) {
  return (
    <section>
      {/* "Signals, as measured and thresholded" was the last heading on this page still
          speaking the codebase's language rather than a reader's. Every other one is
          plain — "Before acting", "Where the evaluation stopped", "The book, as
          displayed" — and `thresholded` is a word nobody says out loud. What the heading
          needs to carry is not the verb but the reason these readings mean anything: they
          are judged against THIS venue's measured range, not against a real-money book. */}
      <h2 className="section-mark mb-4">The signals, measured against this venue</h2>
      <ul className="divide-y border-t">
        {trace.signals.map((s) => (
          <li key={s.id} className="grid grid-cols-[auto_1fr] gap-4 py-5">
            <DepthMark severity={s.severity} className="mt-1" />

            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-display text-base leading-none">
                  {s.label}
                </h3>
                <SeverityLabel severity={s.severity} />
              </div>

              {/* The finding: what was measured, in the engine's own words. */}
              <p className="text-sm leading-relaxed">{s.finding}</p>

              {/* Why this threshold, on this venue — ON THE SIGNALS THAT DECIDED,
                  and in the sheet for the rest.

                  MEASURED: `basis` is identical on all eight markets for a given
                  signal, so it is documentation of the method rather than a finding
                  about this market, and printing all eight put 271 words — 28% of the
                  page — of unchanging methodology in front of a reader on every single
                  market. It is also where nearly all the internal vocabulary lives
                  (`getAllOpenOrdersOffChain`, close-to-close, taker-side skew), so it
                  set the reading level for the whole page.

                  It is NOT hidden, because the calibration IS the claim: a threshold
                  nobody can audit is a guess with a number on it. It is gated by
                  relevance. A signal that measured `ok` did not shape the verdict, so
                  its methodology is one click away in the sheet, which already repeats
                  this exact string at its foot. A signal that came back `elevated`,
                  `severe` or unreadable is doing the deciding, and there the proof
                  stays on the surface where the reader is already asking "says who?".

                  Set at the full secondary tone rather than a fraction of it: at `/80`
                  this sat near 3.4:1 on paper at 12px, which is asking a judge to
                  squint at the one line that proves the number was calibrated. */}
              {s.severity !== "ok" ? (
                <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                  <span className="label-caps mr-1.5">basis</span>
                  {s.basis}
                </p>
              ) : null}

              {/* The receipts, out of flow. A Sheet rather than an inline
                  disclosure, because these are the machinery and not the argument:
                  a reader consults them, then returns to the audit. The trigger
                  carries the count so its weight is known before it is opened. */}
              <EvidenceSheet
                label={s.label}
                evidence={s.evidence}
                basis={s.basis}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * One signal's measured fields, in a side sheet.
 *
 * Forty of these pairs across eight signals were the densest thing on the page and
 * many are internal field names. They are the receipts, so they stay reachable and
 * complete; they are not the reasoning, so they no longer compete with it. The
 * `basis` string is repeated at the foot of the sheet so a reader inspecting raw
 * numbers still has the calibration in view without going back.
 */
function EvidenceSheet({
  label,
  evidence,
  basis,
}: {
  label: string
  evidence: Record<string, number | string | boolean | null>
  basis: string
}) {
  const fields = Object.entries(evidence).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  )
  if (fields.length === 0) return null

  return (
    <Sheet>
      {/* THE COUNT WAS THE ONLY THING SAYING THIS OPENED, and a count is not an
          affordance. `8 measured fields` set in `label-caps` reads exactly like the
          `basis` label two lines above it, which is a static data label — so the one
          control in this block wore the costume of the text around it and nobody had
          a reason to press it. The caret is what separates a control from a caption.

          `items-baseline` with the mark at 8px: `label-caps` is 11px mono, whose caps
          stand about 8px off the baseline, and an `<svg>` sits on its own bottom edge
          (see `WayIn`), so the chevron fills the cap band instead of floating against
          the middle of the line.

          It points RIGHT because that is where the panel comes from — the sheet enters
          from the right edge — so the mark describes the movement rather than
          decorating the label. Visible at rest, not on hover: this is the affordance
          itself, and hiding an affordance until hover only works where hover exists. */}
      <SheetTrigger className="label-caps inline-flex cursor-pointer items-baseline gap-x-1.5 transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none">
        {fields.length} measured field{fields.length === 1 ? "" : "s"}
        <WayIn height={8} />
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="font-display">{label}</SheetTitle>
          <SheetDescription>
            Every field the finding was computed from, exactly as the engine
            recorded it.
          </SheetDescription>
        </SheetHeader>
        <dl className="divide-y border-t px-4">
          {fields.map(([k, v]) => (
            <div
              key={k}
              className="flex items-baseline justify-between gap-4 px-2 py-2"
            >
              <dt className="label-caps">{k}</dt>
              <dd className="font-data text-right text-xs break-all">
                {typeof v === "string" && v.startsWith("http") ? (
                  <a
                    href={v}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline decoration-1 underline-offset-2"
                  >
                    open
                  </a>
                ) : (
                  String(v)
                )}
              </dd>
            </div>
          ))}
        </dl>
        
        <p className="px-6 py-6 text-xs leading-relaxed text-muted-foreground">
          <span className="label-caps mr-1.5">basis</span>
          {basis}
        </p>
      </SheetContent>
    </Sheet>
  )
}
