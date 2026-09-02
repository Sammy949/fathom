"use client"

import { useMemo, useState } from "react"

import { MarketList } from "@/components/market-list"
import { cn } from "@/lib/utils"
import type { MarketRow } from "@/lib/venue"

/**
 * Verdict triage.
 *
 * The index answers one question: which of these can I act on. So the filter is by
 * VERDICT, plus one toggle for markets carrying an unmeasured signal, and there is
 * deliberately no search box and no asset or window filter.
 *
 * WHY NOT SEARCH. Queried live: this venue lists ten markets across two assets
 * (BTC and ETH) and five window lengths, of which eight are long enough to assess.
 * Every row fits on one screen. A search field over eight rows implies a corpus that
 * does not exist and would almost never earn a keystroke. If the board ever passes
 * roughly twenty-five rows, search becomes the right control and this is where it
 * goes; until then it would be chrome.
 *
 * The counts are computed from the rows rather than passed in, so a filter chip can
 * never disagree with the list under it.
 */
const VERDICTS = ["ALLOW", "RECHECK", "BLOCK"] as const
type Verdict = (typeof VERDICTS)[number]

const VERDICT_INK: Record<Verdict, string> = {
  ALLOW: "var(--verdict-allow)",
  RECHECK: "var(--verdict-recheck)",
  BLOCK: "var(--verdict-block)",
}

export function MarketBoard({ rows }: { rows: MarketRow[] }) {
  const [only, setOnly] = useState<Verdict | null>(null)
  const [unmeasuredOnly, setUnmeasuredOnly] = useState(false)

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) c[r.verdict] = (c[r.verdict] ?? 0) + 1
    return c
  }, [rows])

  const unmeasuredCount = useMemo(() => rows.filter((r) => r.unmeasured > 0).length, [rows])

  const shown = useMemo(
    () =>
      rows.filter(
        (r) => (only === null || r.verdict === only) && (!unmeasuredOnly || r.unmeasured > 0),
      ),
    [rows, only, unmeasuredOnly],
  )

  const filtered = only !== null || unmeasuredOnly

  return (
    <div>
      {/* One row of toggles, sharp-edged, no pills. A filter that is off carries no
          fill at all; the active one inverts. Counts sit beside each label so the
          shape of the board is readable without touching anything. */}
      <div className="mb-6 flex flex-wrap items-center gap-x-1 gap-y-2">
        <Toggle active={only === null && !unmeasuredOnly} onClick={() => { setOnly(null); setUnmeasuredOnly(false) }}>
          all <Count n={rows.length} />
        </Toggle>

        {VERDICTS.map((v) => (
          <Toggle
            key={v}
            active={only === v}
            disabled={(counts[v] ?? 0) === 0}
            ink={VERDICT_INK[v]}
            onClick={() => setOnly(only === v ? null : v)}
          >
            {v.toLowerCase()} <Count n={counts[v] ?? 0} />
          </Toggle>
        ))}

        <Toggle
          active={unmeasuredOnly}
          disabled={unmeasuredCount === 0}
          onClick={() => setUnmeasuredOnly((u) => !u)}
        >
          unmeasured <Count n={unmeasuredCount} />
        </Toggle>
      </div>

      {shown.length === 0 && filtered ? (
        // A filter that hides everything must say so, and say what it hid. Silence
        // here reads as a broken page.
        <p className="text-muted-foreground py-16 text-center text-sm">
          No market on this board matches that filter.{" "}
          <button
            type="button"
            className="hover:text-foreground underline decoration-1 underline-offset-2"
            onClick={() => {
              setOnly(null)
              setUnmeasuredOnly(false)
            }}
          >
            Show all {rows.length}
          </button>
        </p>
      ) : (
        <MarketList rows={shown} />
      )}
    </div>
  )
}

function Toggle({
  active,
  disabled,
  ink,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  ink?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "label-caps border px-2.5 py-1 transition-colors",
        "focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none",
        disabled && "cursor-not-allowed opacity-40",
        active
          ? "bg-foreground text-background border-foreground"
          : "hover:text-foreground border-transparent",
      )}
      style={!active && ink ? { color: ink } : undefined}
    >
      {children}
    </button>
  )
}

/** The figure, set as data even at this size. */
function Count({ n }: { n: number }) {
  return <span className="font-data ml-0.5 tracking-normal">{n}</span>
}
