import type { DecisionTrace } from "@fathom/core"

import { cn } from "@/lib/utils"

/**
 * The gate ladder: which check ended the evaluation.
 *
 * This REPLACES the numbered rule list, it is not an addition. That list printed raw
 * rule ids in mono ("no-onchain-state", "unobservable-liquidity") next to zero-padded
 * indices, which is the same internal-identifier leak just cleaned out of the model's
 * prose, in a different typeface. Same information, honest form, and one fewer block
 * on the page.
 *
 * WHY A LADDER AND NOT A WATERFALL. A financial waterfall shows signed contributions
 * summing to a total, and `assess()` is not additive: it is a short-circuit state
 * machine. Wrong venue stops everything; then cannot-settle; then any severe signal;
 * then an unreadable book; then any unmeasured signal; then any elevated one. ONE gate
 * decides and the rest are context, so a waterfall would misrepresent the logic it was
 * drawn to explain. The model that fits is the one Stripe Radar and KYC decisioning
 * use: an ordered gate sequence where the first failing gate short-circuits the rest.
 *
 * The three states are the point, and the third is the one no other view shows:
 *
 *   passed       the check ran and cleared.
 *   stopped      this gate decided the verdict. Carries the verdict's own colour and
 *                the engine's own sentence for why.
 *   not reached  never evaluated, because an earlier gate already decided. Drawn as
 *                absent rather than as passing, for exactly the reason `unknown` is a
 *                different shape in the sounding: a check that did not run must not
 *                read as a check that succeeded.
 *
 * The rail is the sounding's metaphor rotated into the rule domain: a line descending
 * until it finds bottom. It FRACTURES at the deciding gate, the same broken shape the
 * sounding uses for severe, and stops there. Below that there is no line, because
 * there was no evaluation.
 */

/**
 * The engine's gates, in the order `assess()` evaluates them.
 *
 * ORDER IS LOAD-BEARING, and it is `assess()`'s order rather than a tidier one: venue,
 * settlement, any severe signal, then the unreadable book, then incomplete observation,
 * then elevated. `gradeSnapshot` wraps that with the on-chain override, which is why
 * the chain gate is first here: it is checked before the signal mapping is consulted at
 * all. Every rule id the engine can emit maps to exactly one of these, verified against
 * the full set in `risk.ts`; `all-clear` matches none, which is the ALLOW path where
 * every gate cleared.
 */
const GATES: { label: string; checks: string; matches: (rule: string) => boolean }[] = [
  {
    label: "Chain confirms it is trading",
    checks: "On-chain status, which is authoritative. The indexer trails it and can disagree.",
    matches: (r) => r === "not-trading" || r === "no-onchain-state",
  },
  {
    label: "On the real venue",
    checks: "Six venues carry binary rows on this testnet; only one hosts real event contracts.",
    matches: (r) => r === "wrong-venue",
  },
  {
    label: "Can settle",
    checks: "An oracle question is bound, not voided, not superseded, and its window has not lapsed.",
    matches: (r) => r === "cannot-settle",
  },
  {
    label: "Nothing blocking",
    checks: "No signal measured severe against this venue's calibrated thresholds.",
    matches: (r) => r.startsWith("severe:"),
  },
  {
    label: "The book is readable",
    checks: "Without a book there is no tradability to assess, so its absence is disqualifying alone.",
    matches: (r) => r === "unobservable-liquidity",
  },
  {
    label: "Everything measured",
    checks: "A single unmeasured signal withholds ALLOW. Silence is not safety.",
    matches: (r) => r === "incomplete-observation",
  },
  {
    label: "Nothing elevated",
    checks: "No signal sits above this venue's normal range.",
    matches: (r) => r.startsWith("elevated:"),
  },
]

type GateState = "passed" | "stopped" | "not-reached"

export function GateLadder({ trace }: { trace: DecisionTrace }) {
  // The FIRST rule is always the decisive one: `assess()` returns on the first gate
  // that fires, and `gradeSnapshot` prepends the on-chain override ahead of the rest.
  // Anything after it in the array is context the engine chose to keep, not a second
  // decision.
  const decisive = trace.rules[0]
  const stoppedAt = decisive ? GATES.findIndex((g) => g.matches(decisive.rule)) : -1

  const stateOf = (i: number): GateState => {
    if (stoppedAt === -1) return "passed" // ALLOW: every gate cleared
    if (i < stoppedAt) return "passed"
    if (i === stoppedAt) return "stopped"
    return "not-reached"
  }

  const verdictInk =
    trace.verdict === "ALLOW"
      ? "var(--verdict-allow)"
      : trace.verdict === "RECHECK"
        ? "var(--verdict-recheck)"
        : "var(--verdict-block)"

  return (
    <section>
      <h2 className="section-mark mb-4">Where the evaluation stopped</h2>

      <ol className="border-t">
        {GATES.map((g, i) => {
          const state = stateOf(i)
          return (
            <li
              key={g.label}
              className={cn(
                "relative grid grid-cols-[1.25rem_1fr] gap-3 py-3",
                state === "not-reached" && "opacity-45",
              )}
            >
              <Rail state={state} ink={verdictInk} last={i === GATES.length - 1} />

              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <h3
                    className={cn("text-sm leading-snug", state === "stopped" && "font-medium")}
                    style={state === "stopped" ? { color: verdictInk } : undefined}
                  >
                    {g.label}
                  </h3>
                  <span className="label-caps">
                    {state === "passed" ? "passed" : state === "stopped" ? "decided it" : "not reached"}
                  </span>
                </div>

                {/* On the deciding gate, the engine's own sentence. On every other
                    gate, what it checks - which is what makes the sequence legible
                    rather than a list of words. */}
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {state === "stopped" ? decisive?.because : g.checks}
                </p>
              </div>
            </li>
          )
        })}
      </ol>

      {/* The outcome, stated at the foot of the sequence it came from. */}
      <p className="mt-3 flex items-baseline gap-2 text-xs">
        <span className="label-caps">therefore</span>
        <span className="font-display" style={{ color: verdictInk }}>
          {trace.verdict}
        </span>
      </p>
    </section>
  )
}

/**
 * One rung of the rail.
 *
 * Drawn in CSS rather than SVG because the rows are variable height: an SVG per row
 * cannot connect to its neighbours without measuring, and a single SVG behind the
 * list would need the row heights it does not have.
 */
function Rail({ state, ink, last }: { state: GateState; ink: string; last: boolean }) {
  return (
    <div aria-hidden className="relative">
      {state === "passed" ? (
        <>
          {/* Continuous through a cleared gate, except at the very bottom. */}
          {!last ? (
            <span className="bg-border absolute top-2.5 bottom-[-0.75rem] left-[0.4rem] w-px" />
          ) : null}
          <span className="bg-muted-foreground absolute top-[0.3rem] left-[0.25rem] size-1.5" />
        </>
      ) : null}

      {state === "stopped" ? (
        <>
          {/* THE FRACTURE. Two segments, laterally offset, that do not meet - the same
              broken shape the sounding uses for a severe reading, and it means the same
              thing: the line did not continue. Nothing is drawn below, because nothing
              below was evaluated. */}
          <span
            className="absolute top-0 left-[0.4rem] h-[0.3rem] w-px"
            style={{ backgroundColor: ink }}
          />
          <span
            className="absolute top-[0.55rem] left-[0.55rem] h-[0.35rem] w-px"
            style={{ backgroundColor: ink }}
          />
          <span
            className="absolute top-[0.9rem] left-[0.2rem] h-[3px] w-2.5"
            style={{ backgroundColor: ink }}
          />
        </>
      ) : null}

      {state === "not-reached" ? (
        // Hollow, and no rail. An absent check reads as absent.
        <span className="border-muted-foreground absolute top-[0.3rem] left-[0.25rem] size-1.5 border" />
      ) : null}
    </div>
  )
}
