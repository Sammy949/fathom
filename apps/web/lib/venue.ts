/**
 * Server-side market data for the dashboard.
 *
 * Everything here runs on the server, never in the browser. That is not a
 * performance preference: the Groq key and the venue config live in `.env`, and
 * the SDK opens a chain client, so neither belongs in a client bundle.
 *
 * HOW THIS SERVES A PAGE, AND WHY IT IS SHAPED THIS WAY. One ingestion pass is
 * roughly 150 network round trips (10 markets, each needing an on-chain snapshot,
 * a settlement window, a materialized book, both sides of the per-order book, and
 * owner classification, plus candles, fills and an oracle row), followed by up to
 * two sequential model calls. On a good connection that is seconds. On this box,
 * where the SDK's WebSocket transport times out at 4s and IPv6 is unreachable, it
 * can be minutes.
 *
 * So a request NEVER waits for a fresh pass when there is anything to serve:
 *
 *   cold          the first caller awaits, because there is no alternative
 *   fresh         served from cache
 *   stale         served from cache IMMEDIATELY, refresh kicked off behind it
 *   refresh fails the last good read keeps being served, and says how old it is
 *
 * That is stale-while-revalidate, and it is honest here for the same reason the
 * cache was always honest: every snapshot carries `assembledAt` and per-field
 * provenance, and the masthead states when the read was taken. A page that says
 * "read 3m ago" is telling the truth; a page that hangs for two minutes is not
 * telling anyone anything.
 *
 * STATE LIVES ON `globalThis`, NOT IN MODULE SCOPE. In `next dev` a file save
 * re-evaluates this module, so module-level state resets: the warm cache is lost
 * and, worse, `createExchange` runs again while the previous client's WebSocket,
 * its 15-second heads watchdog and its backoff reconnect timer keep running with
 * nothing left holding a reference to close them. Several saves into a session
 * that is a set of orphaned sockets all probing a half-answering endpoint on
 * timers, which is measurably a hot machine. Pinning to `globalThis` is the same
 * pattern a database client needs in dev, and for the same reason.
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { createExchange, type EcContext } from "@fathom/ec"
import {
  buildTrace,
  explainAssessment,
  gradeSnapshot,
  ingestVenue,
  type DecisionTrace,
} from "@fathom/core"

/**
 * A frozen board, read from disk instead of from the venue.
 *
 * WHY THIS EXISTS, and it is two reasons rather than one.
 *
 * The dev loop. A live pass is ~150 round trips plus up to two model calls, and
 * the dashboard is almost entirely server components, so iterating on type and
 * colour meant waiting minutes per look at a page while a watcher and a chain
 * socket sat on a 4-core VM. With a fixture the render touches no network at all:
 * no exchange, no WebSocket, no retries, no Groq budget.
 *
 * The demo. Three `grade` runs inside two hours gave 0 ALLOW / 10 RECHECK / 0
 * BLOCK, then 0 / 4 / 6, then 0 / 9 / 1. All three were correct; the board simply
 * moves. A frozen board is the only way to guarantee that what is on screen shows
 * the full range of verdicts, including the stuck market, rather than whatever the
 * venue happens to be doing at that minute.
 *
 * Live is the DEFAULT, so a deploy behaves as it always did. `FATHOM_FIXTURE=1`
 * opts in to the committed board; `FATHOM_FIXTURE=<path>` points at another one.
 */
const FIXTURE_ENV = (process.env.FATHOM_FIXTURE ?? "").trim()

/**
 * Where the frozen board lives.
 *
 * `FATHOM_FIXTURE=1` walks UP from the working directory looking for
 * `fixtures/board.json`, rather than assuming a fixed number of `..` hops. Next
 * runs with cwd at `apps/web` while a workspace script runs from the repo root,
 * and hardcoding `../../fixtures` for the first silently resolved to
 * `/home/samy/fixtures` for the second. Same walk-up that `loadEnv` uses to find
 * `.env`, for the same reason. Any other value is taken as a literal path.
 */
function fixturePath(): string {
  if (FIXTURE_ENV !== "1" && FIXTURE_ENV.toLowerCase() !== "true") return FIXTURE_ENV
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "fixtures", "board.json")
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Nothing found: return the most likely path so the error names something real.
  return join(process.cwd(), "fixtures", "board.json")
}

/**
 * How long a read stays fresh, and the floor between passes.
 *
 * The TTL has to exceed a realistic pass duration or stale-while-revalidate
 * degrades into revalidate-always: a 45s TTL against a pass that can take minutes
 * means a refresh is in flight essentially all the time, which is the fan-spinning
 * behaviour in a different costume. `MIN_REFRESH_GAP_MS` is the hard floor
 * measured from the END of the last pass, so a slow pass cannot chain into the
 * next one.
 */
const TTL_MS = 120_000
const MIN_REFRESH_GAP_MS = 60_000

/** Markets shorter than this expire before anyone can read a verdict. */
const MIN_INTERVAL_SEC = 900

/**
 * How many markets get a model-written explanation per read.
 *
 * TWO on a live request, because two is what the free tier actually fits.
 * Measured: the prompt runs ~2,000 input tokens and Groq bills
 * `max_completion_tokens` as REQUESTED, so a call costs ~4,000 against an
 * 8,000/minute ceiling. A third call is guaranteed a 429 and lands on the fallback
 * narrator, which is correct behaviour but reads as the model failing rather than
 * as a budget choice.
 *
 * A CAPTURE IS DIFFERENT and gets to override this with
 * `FATHOM_EXPLAIN_BUDGET`. A frozen board is written once and then read all day,
 * so it can afford to spend four minutes letting the 429 retry pace itself and
 * come back with every market model-explained. Two of eight is a thin thing to
 * freeze into a demo when patience is free.
 *
 * Read at call time, not at import: `capture-board.ts` sets the variable in its
 * own `main`, and ESM hoists imports above that, so a module-level constant would
 * have been evaluated before the override existed.
 */
const explainBudget = (): number => Number(process.env.FATHOM_EXPLAIN_BUDGET ?? 2) || 2

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
  /**
   * Seconds until the median resting order expires, and how many addresses own
   * the displayed book.
   *
   * Carried into the list because this is the one column no other venue interface
   * can show: `owner` and `expireTimestampNs` exist per order on the chain read
   * and are summed away by every aggregated view. A book that reads "990 shares a
   * side" everywhere else is one address on a 20-second timer, and that belongs at
   * the top level rather than three clicks down.
   */
  quoteTtlSec: number | null
  owners: number | null
  /** Count of signals that could not be measured, which drives the depth reading. */
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

/**
 * Everything that must outlive a dev recompile, in one place.
 *
 * `ctx` in particular: `createExchange` opens a WebSocket lazily on first chain
 * I/O and the SDK ships `close()` for a reason. Left in module scope, a file save
 * abandons the live one and builds another.
 */
type VenueState = {
  ctx: EcContext | null
  cached: { at: number; data: VenueRead } | null
  inflight: Promise<VenueRead> | null
  /** Wall clock (ms) the last pass FINISHED, pass or fail. Gates the cooldown. */
  lastAttemptEndedAt: number
}

const store = globalThis as unknown as { __fathomVenue?: VenueState }
store.__fathomVenue ??= { ctx: null, cached: null, inflight: null, lastAttemptEndedAt: 0 }
const state = store.__fathomVenue

/** One exchange client per process. Opening one per request leaks sockets. */
function exchange(): EcContext {
  state.ctx ??= createExchange({ withSigner: false })
  return state.ctx
}

/**
 * Run one full ingestion pass and assemble the read.
 *
 * Exported, uncached, and free of any dependency on the request lifecycle, so
 * `npm run capture:board` can call the EXACT code path the dashboard uses to
 * freeze a board fixture. A capture script that reimplemented this would drift
 * from it, and a fixture that does not match what the page would have rendered is
 * worse than no fixture.
 */
export async function buildVenueRead(): Promise<VenueRead> {
  const ec = exchange()
  const { snapshots, failures, venueId, assembledAt, usable } = await ingestVenue(ec, {
    minIntervalSec: MIN_INTERVAL_SEC,
  })

  const graded = snapshots.map((snapshot) => ({ snapshot, assessment: gradeSnapshot(snapshot) }))

  // Explain the first few. `Promise.all` would fire them concurrently and trip
  // the TPM ceiling on all of them at once, so these are sequential on purpose —
  // the 429 retry inside the provider can then actually clear.
  const budget = explainBudget()
  const traces: Record<string, DecisionTrace> = {}
  for (const [i, { snapshot, assessment }] of graded.entries()) {
    const explanation =
      i < budget
        ? await explainAssessment(snapshot, assessment)
        : await explainAssessment(snapshot, assessment, { offline: true })
    traces[snapshot.identity.marketId] = buildTrace(snapshot, assessment, explanation)
  }

  const rows: MarketRow[] = graded.map(({ snapshot, assessment }) => {
    const book = snapshot.book.value
    const fresh = snapshot.freshness.value
    const depth = snapshot.depth.value
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
      quoteTtlSec: depth?.medianTtlSec ?? null,
      owners: depth?.owners ?? null,
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
 * Start a pass, or join the one already running.
 *
 * Concurrent callers share one in-flight read rather than each starting their own.
 * Otherwise a page with several server components fans out into duplicate
 * ingestion passes and multiplies both the round trips and the Groq spend.
 */
function beginRead(): Promise<VenueRead> {
  state.inflight ??= buildVenueRead()
    .then((data) => {
      state.cached = { at: Date.now(), data }
      return data
    })
    .finally(() => {
      state.inflight = null
      state.lastAttemptEndedAt = Date.now()
    })
  return state.inflight
}

/** True when enough time has passed since the last pass ENDED to start another. */
const refreshAllowed = (): boolean =>
  !state.inflight && Date.now() - state.lastAttemptEndedAt >= MIN_REFRESH_GAP_MS

/**
 * The venue read: warm cache first, freshness second.
 *
 * A stale read served now beats a fresh read served in two minutes, because the
 * page states its own age and a hanging page states nothing. The only caller that
 * waits is the one that arrives with nothing cached at all.
 */
export async function getVenueRead(): Promise<VenueRead> {
  // A fixture is read once and then answered from memory. No exchange is ever
  // constructed on this path, so no socket is opened and nothing needs closing.
  if (FIXTURE_ENV) {
    if (!state.cached) {
      const path = fixturePath()
      try {
        state.cached = {
          at: Date.now(),
          data: JSON.parse(readFileSync(path, "utf8")) as VenueRead,
        }
      } catch (e) {
        throw new Error(
          `FATHOM_FIXTURE is set but ${path} could not be read. Run \`npm run capture:board\` ` +
            `once against the live venue, or unset FATHOM_FIXTURE to read live. ` +
            `(${e instanceof Error ? e.message : String(e)})`,
        )
      }
    }
    return state.cached.data
  }

  const hit = state.cached

  if (hit) {
    const age = Date.now() - hit.at
    if (age >= TTL_MS && refreshAllowed()) {
      // Deliberately not awaited. `catch` is attached so a failed background pass
      // cannot surface as an unhandled rejection and take the process down; the
      // failure is invisible to this request by design, and the next one still
      // sees the old `assembledAt`.
      void beginRead().catch(() => undefined)
    }
    return hit.data
  }

  // Cold. Nothing to serve but the pass itself.
  try {
    return await beginRead()
  } catch (e) {
    // A failed read must not blank the page. Serve the last good data with its
    // real `assembledAt` so the UI can show how stale it is; only a cold cache
    // surfaces the error.
    if (state.cached) return state.cached.data
    throw e
  }
}

export async function getTrace(marketId: string): Promise<DecisionTrace | null> {
  const { traces } = await getVenueRead()
  return traces[marketId] ?? null
}
