/**
 * Server-side market data for the dashboard.
 *
 * Everything here runs on the server, never in the browser. That is not a
 * performance preference — the Groq key and the venue config live in `.env`, and
 * the SDK opens a chain client; neither belongs in a client bundle.
 *
 * Caching is a short in-memory TTL rather than a store. The verdict engine is
 * deterministic and the venue's markets roll on fixed windows, so a stale-by-
 * seconds read is honest as long as the UI says when it was taken — which is why
 * every snapshot carries `assembledAt` and per-field provenance. A cache also
 * keeps the free-tier Groq budget intact: without it, every page navigation
 * would re-explain three markets and burn the 8,000 TPM ceiling.
 */

import { createExchange, type EcContext } from "@fathom/ec"
import {
  buildTrace,
  explainAssessment,
  gradeSnapshot,
  ingestVenue,
  type DecisionTrace,
} from "@fathom/core"

/** How long a full read stays fresh. Long enough to survive a demo click-through. */
const TTL_MS = 45_000

/** Markets shorter than this expire before anyone can read a verdict. */
const MIN_INTERVAL_SEC = 900

/**
 * How many markets get a model-written explanation per read.
 *
 * TWO, because two is what the free tier actually fits. Measured: the prompt runs
 * ~2,000 input tokens and Groq bills `max_completion_tokens` as REQUESTED, so a
 * call costs ~4,000 against an 8,000/minute ceiling. Three calls guarantee that
 * the third gets a 429 and lands on the fallback narrator — which is correct
 * behaviour and reads as the model failing rather than as a budget choice.
 *
 * So the list explains nothing at all, and the detail view explains on demand.
 */
const EXPLAIN_BUDGET = 2

export interface MarketRow {
  marketId: string
  symbol: string
  asset: string | null
  intervalSec: number | null
  verdict: DecisionTrace["verdict"]
  confidence: number
  action: DecisionTrace["action"]
  /** Severity per signal id, for the list-level sounding marks. */
  severities: { id: string; label: string; severity: string }[]
  /** Headline number pair, so the list shows real prices rather than chrome. */
  mid: number | null
  spread: number | null
  lastTradeAgeSec: number | null
  secToExpiry: number
  /** Count of signals that could not be measured — drives the depth reading. */
  unmeasured: number
}

export interface VenueRead {
  rows: MarketRow[]
  traces: Record<string, DecisionTrace>
  assembledAt: number
  venueId: string
  /** Markets the indexer listed but that could not be snapshotted at all. */
  failures: { marketId: string; reason: string }[]
  /** True when at least one market is gradeable — what the UI checks. */
  usable: boolean
  degraded: boolean
}

let cached: { at: number; data: VenueRead } | null = null
let inflight: Promise<VenueRead> | null = null

/** One exchange client per process. Opening one per request leaks sockets. */
let ctx: EcContext | null = null
function exchange(): EcContext {
  ctx ??= createExchange({ withSigner: false })
  return ctx
}

async function read(): Promise<VenueRead> {
  const ec = exchange()
  const { snapshots, failures, venueId, assembledAt, usable } = await ingestVenue(ec, {
    minIntervalSec: MIN_INTERVAL_SEC,
  })

  const graded = snapshots.map((snapshot) => ({ snapshot, assessment: gradeSnapshot(snapshot) }))

  // Explain the first few. `Promise.all` would fire them concurrently and trip
  // the TPM ceiling on all of them at once, so these are sequential on purpose —
  // the 429 retry inside the provider can then actually clear.
  const traces: Record<string, DecisionTrace> = {}
  for (const [i, { snapshot, assessment }] of graded.entries()) {
    const explanation =
      i < EXPLAIN_BUDGET
        ? await explainAssessment(snapshot, assessment)
        : await explainAssessment(snapshot, assessment, { offline: true })
    traces[snapshot.identity.marketId] = buildTrace(snapshot, assessment, explanation)
  }

  const rows: MarketRow[] = graded.map(({ snapshot, assessment }) => {
    const book = snapshot.book.value
    const fresh = snapshot.freshness.value
    return {
      marketId: snapshot.identity.marketId,
      symbol: snapshot.identity.symbol,
      asset: snapshot.identity.asset,
      intervalSec: snapshot.identity.intervalSec,
      verdict: assessment.verdict,
      confidence: assessment.confidence,
      action: assessment.action,
      severities: assessment.signals.map((s) => ({
        id: s.id,
        label: s.label,
        severity: s.severity,
      })),
      mid: book?.mid ?? null,
      spread: book?.spread ?? null,
      lastTradeAgeSec: fresh?.lastTradeAgeSec ?? null,
      secToExpiry: fresh?.secToExpiry ?? 0,
      unmeasured: assessment.unknownSignals.length,
    }
  })

  return {
    rows,
    traces,
    assembledAt,
    venueId,
    failures: failures.map((f) => ({ marketId: f.marketId, reason: f.reason })),
    usable,
    degraded: failures.length > 0 || rows.some((r) => r.unmeasured > 0),
  }
}

/**
 * The venue read, cached.
 *
 * Concurrent callers share one in-flight read rather than each starting their
 * own — otherwise a page with several server components would fan out into
 * duplicate ingestion passes and multiply the Groq spend.
 */
export async function getVenueRead(): Promise<VenueRead> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data
  if (inflight) return inflight

  inflight = read()
    .then((data) => {
      cached = { at: Date.now(), data }
      return data
    })
    .finally(() => {
      inflight = null
    })

  try {
    return await inflight
  } catch (e) {
    // A failed read must not blank the page. Serve the last good data with its
    // real `assembledAt` so the UI can show how stale it is; only a cold cache
    // surfaces the error.
    if (cached) return cached.data
    throw e
  }
}

export async function getTrace(marketId: string): Promise<DecisionTrace | null> {
  const { traces } = await getVenueRead()
  return traces[marketId] ?? null
}
