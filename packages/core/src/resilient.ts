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

export const DEFAULT_SDK_RETRY: SdkRetryPolicy = {
  attempts: 4,
  baseDelayMs: 400,
  maxDelayMs: 6_000,
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
 * query should fail loudly, not four times slowly.
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
