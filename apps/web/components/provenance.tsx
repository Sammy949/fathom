/**
 * The provenance strip: which reads were fresh, stale, or unavailable.
 *
 * Almost no dashboard shows this, which is exactly why it belongs here. Fathom's
 * claim is that every number traces to a measurement; the corollary is that when
 * a measurement did not arrive, the interface has to say so rather than render a
 * confident zero. `degraded` and `absent` are different facts and are labelled
 * differently: one is a source we could not reach, the other is a field the
 * market genuinely does not have.
 *
 * The marks follow the ink scale rather than a status palette, and the SHAPE
 * carries the state, not just the tone: a read is a filled square, an unreachable
 * source is a hollow one, and a field that does not exist is a rule. So the strip
 * is legible in greyscale, and "we could not reach this" never looks like a
 * decorative status dot.
 */

import { ago } from "@/lib/format"

const STATE_LABEL: Record<string, string> = {
  ok: "read",
  degraded: "unreachable",
  absent: "not present",
}

const STATE_INK: Record<string, string> = {
  ok: "var(--ink-ok)",
  degraded: "var(--ink-elevated)",
  absent: "var(--ink-unknown)",
}

/**
 * Filled square for a real read, hollow for a failed one, rule for absent.
 *
 * CENTRED BY CONSTRUCTION, not by a tuned margin. The first version hung the marks
 * off `items-baseline` with `mt-1.5` and `mt-2`, which is a guess dressed as a
 * measurement: an empty flex item's baseline is its BOTTOM MARGIN EDGE, so those
 * margins moved the box's height rather than its position and the two variants were
 * never differentially placed the way the values implied. Nobody would catch that
 * without rendering it, and it cannot be rendered cheaply here.
 *
 * So the mark now sits in a box the exact height of the text's line (`h-4` against
 * `leading-4`) and is centred inside it. That is deterministic, needs no eyeball, and
 * survives a change of font.
 */
function StateMark({ state }: { state: string }) {
  const ink = STATE_INK[state] ?? "var(--ink-unknown)"
  return (
    <span aria-hidden className="flex h-4 w-1.5 shrink-0 items-center">
      {state === "absent" ? (
        <span className="h-px w-full" style={{ backgroundColor: ink }} />
      ) : (
        <span
          className="size-1.5"
          style={
            state === "ok"
              ? { backgroundColor: ink }
              : { border: `1px solid ${ink}`, backgroundColor: "transparent" }
          }
        />
      )}
    </span>
  )
}

export function Provenance({
  entries,
}: {
  entries: { field: string; state: string; readAt: number; reason?: string }[]
}) {
  return (
    <div>
      <h3 className="section-mark mb-3">Provenance</h3>
      <dl className="space-y-1.5">
        {entries.map((e) => (
          <div key={e.field} className="flex items-start gap-2 text-xs leading-4">
            <StateMark state={e.state} />
            <dt className="font-data w-20 shrink-0">{e.field}</dt>
            <dd className="text-muted-foreground min-w-0 flex-1">
              <span style={e.state === "ok" ? undefined : { color: STATE_INK[e.state] }}>
                {STATE_LABEL[e.state] ?? e.state}
              </span>
              {/* No opacity step on either of these. Both sat around 3:1 at 12px,
                  and the reason line is the most important string in this strip when
                  it exists: it is why a read failed. Rank comes from position and
                  size, not from fading text under the legibility floor. */}
              <span> · {ago(e.readAt)}</span>
              {e.reason ? (
                <span className="block truncate" title={e.reason}>
                  {e.reason}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
