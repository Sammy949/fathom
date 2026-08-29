/**
 * The provenance strip — which reads were fresh, stale, or unavailable.
 *
 * Almost no dashboard shows this, which is exactly why it belongs here. Fathom's
 * claim is that every number traces to a measurement; the corollary is that when
 * a measurement did not arrive, the interface has to say so rather than render a
 * confident zero. `degraded` and `absent` are different facts and are labelled
 * differently: one is a source we could not reach, the other is a field the
 * market genuinely does not have.
 */

import { ago } from "@/lib/format"

const STATE_LABEL: Record<string, string> = {
  ok: "read",
  degraded: "unreachable",
  absent: "not present",
}

const STATE_COLOR: Record<string, string> = {
  ok: "var(--sound-ok)",
  degraded: "var(--sound-elevated)",
  absent: "var(--sound-unknown)",
}

export function Provenance({
  entries,
}: {
  entries: { field: string; state: string; readAt: number; reason?: string }[]
}) {
  return (
    <div>
      <h3 className="label-caps mb-3">provenance</h3>
      <dl className="space-y-1.5">
        {entries.map((e) => (
          <div key={e.field} className="flex items-baseline gap-2 text-xs">
            <span
              aria-hidden
              className="mt-1.5 size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: STATE_COLOR[e.state] ?? "var(--sound-unknown)" }}
            />
            <dt className="font-data w-20 shrink-0">{e.field}</dt>
            <dd className="text-muted-foreground min-w-0 flex-1">
              <span style={{ color: STATE_COLOR[e.state] }}>
                {STATE_LABEL[e.state] ?? e.state}
              </span>
              <span className="opacity-60"> · {ago(e.readAt)}</span>
              {e.reason ? (
                <span className="block truncate opacity-60" title={e.reason}>
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
