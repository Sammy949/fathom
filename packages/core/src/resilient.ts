/**
 * Retry for calls that go through the SDK rather than our own query layer.
 *
 * `indexer.ts` protects the queries WE write. It does nothing for the SDK's
 * internal reads — `loadMarkets()` and `getMarketOnchain()` call the SDK's own
 * unretried `postGraphql` and its viem client directly, so they still die on the
 * first hiccup.
 *
 * That gap was not theoretical. With only our queries wrapped, the Stage 2 gate
 * failed 3 runs out of 5, every time inside `loadMarkets` → `listRegistryMarkets`
 * → `postGraphql` with `ETIMEDOUT`. The snapshot layer was resilient and the two
 * SDK entry points feeding it were not, which is worse than obvious fragility
 * because it looks robust right up until the demo.
 *
 * So every SDK call on the ingestion path goes through `withRetry`.
 */

export interface SdkRetryPolicy {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Wide enough to outlast a slow minute on this indexer, not just a slow second.
 *
 * MEASURED, 2026-09-03, because the previous policy looked reasonable and was not.
 * It ran 4 attempts with ceilings of 400/800/1600ms under full jitter, so the
 * EXPECTED total sleep across a whole exhausted retry was 1.4 SECONDS (worst case
 * 2.8s). Meanwhile the testnet indexer's own latency has a long tail: 12 probes came
 * back 200 with a median of 316ms but individual requests ranging 0.7s to 8.3s, and
 * one hit a 20s timeout outright. Four attempts inside a second and a half against a
 * host that stalls for eight is one attempt wearing a costume — the retry returned
 * before the condition it was retrying had a chance to clear.
 *
 * `loadMarkets` is the call that exposed it, and it is the worst one to be impatient
 * about: the SDK's `listRegistryMarkets` is NOT venue-scoped, so it pages the entire
 * registry — measured at 596 rows over 2 pages of 500 — as two separate 30s-bounded
 * requests. Measured pass rate with the old policy: 4 of 5. `capture:board` makes one
 * pass and writes the demo's fixture, so a 20% failure landed exactly where it hurt.
 *
 * Six attempts with ceilings of 1/2/4/8/8s gives an expected ~11.5s of backoff and up
 * to ~23s worst case, which spans the tail rather than the median. The cost is bounded
 * and only paid on failure: a healthy call still returns on the first attempt.
 */
export const DEFAULT_SDK_RETRY: SdkRetryPolicy = {
  attempts: 6,
  baseDelayMs: 1_000,
  maxDelayMs: 8_000,
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Errors worth retrying, walking the `cause` chain.
 *
 * The SDK buries the real reason two levels down: an `IndexerError` wraps a
 * `TypeError: fetch failed` which wraps an `AggregateError` carrying
 * `code: "ETIMEDOUT"`. Only the innermost link says what actually went wrong.
 */
const TRANSIENT_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TRANSIENT_TEXT = [
  "fetch failed",
  "was not json",
  "timeout",
  "timed out",
  "socket hang up",
  "network",
  "econnreset",
  "etimedout",
  "http 5",
  "http 429",
  "rpc_unavailable",
  "carried no data",
  "request failed",
];

export function isTransient(err: unknown, depth = 0): boolean {
  if (!err || depth > 6) return false;

  if (typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;

    // AggregateError from Happy Eyeballs holds one error per attempted address.
    const errors = (err as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.some((e) => isTransient(e, depth + 1))) return true;

    const cause = (err as { cause?: unknown }).cause;
    if (cause && isTransient(cause, depth + 1)) return true;
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // A GraphQL validation error is deterministic — never retry it, or a typo
    // burns four round-trips and then reports itself as an outage.
    if (msg.includes("not found in type") || msg.includes("validation-failed")) return false;
    if (TRANSIENT_TEXT.some((t) => msg.includes(t))) return true;
  }
  return false;
}

/**
 * Run `op`, retrying transient failures with full-jitter backoff.
 *
 * A non-transient error is rethrown immediately: a bad venue id or a malformed
 * query should fail loudly, not six times slowly.
 *
 * Full jitter — `random(0, ceiling)` rather than the ceiling itself — is deliberate:
 * it halves the expected wait while still spreading concurrent retries, and the
 * ingestion path fires many of these at once. The trade is variance, which is why the
 * policy above is sized by its EXPECTED total rather than its worst case.
 */
export async function withRetry<T>(
  label: string,
  op: () => Promise<T>,
  policy: SdkRetryPolicy = DEFAULT_SDK_RETRY,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < policy.attempts; i++) {
    try {
      return await op();
    } catch (e) {
      last = e;
      if (!isTransient(e)) throw e;
      if (i < policy.attempts - 1) {
        const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** i);
        await sleep(Math.random() * ceiling);
      }
    }
  }
  const reason = last instanceof Error ? `${last.name}: ${last.message}` : String(last);
  throw new Error(`${label} failed after ${policy.attempts} attempt(s): ${reason}`, { cause: last });
}
