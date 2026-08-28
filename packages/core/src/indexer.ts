/**
 * Retry-wrapped GraphQL client for the Somnia Markets indexer.
 *
 * WHY THIS EXISTS, and why nothing may bypass it: the SDK's own `postGraphql`
 * issues exactly ONE `fetch` and converts any failure into an `IndexerError`.
 * No retry, no backoff. Every SDK read funnels through it, so a single transient
 * hiccup kills a whole `loadMarkets()`.
 *
 * Measured against the testnet indexer on 2026-08-28: roughly one run in three
 * failed, and the failure mode varied between runs — `ETIMEDOUT` once,
 * `response was not JSON` from the same script minutes later. The indexer itself
 * was healthy throughout (15/15 sequential 400-row queries, 30/30 concurrent,
 * all HTTP 200 with complete bodies). So this is transient network/edge
 * flakiness amplified by having no retry, not an overloaded backend.
 *
 * Retry policy follows DreamDEX's own guidance: timeouts, 5xx, `rpc_unavailable`
 * and connection errors are retryable; 4xx validation errors are terminal.
 * Exponential backoff with jitter, ~500ms base, capped near 30s.
 */

export class IndexerUnavailable extends Error {
  constructor(
    readonly operation: string,
    readonly attempts: number,
    readonly lastReason: string,
    options?: { cause?: unknown },
  ) {
    super(
      `indexer ${operation} failed after ${attempts} attempt(s): ${lastReason}`,
      options,
    );
    this.name = "IndexerUnavailable";
  }
}

/** A GraphQL error the server rejected on validation — retrying cannot help. */
export class IndexerRejected extends Error {
  constructor(
    readonly operation: string,
    readonly gqlMessage: string,
  ) {
    super(`indexer ${operation} rejected the query: ${gqlMessage}`);
    this.name = "IndexerRejected";
  }
}

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  attempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  timeoutMs: 20_000,
};

/** Full jitter: `random(0, min(cap, base * 2^n))`. Avoids retry convoys. */
function backoffMs(attempt: number, policy: RetryPolicy): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.random() * ceiling;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How a single attempt ended, so the caller can decide whether to retry. */
type Attempt<T> =
  | { ok: true; data: T }
  | { ok: false; retryable: boolean; reason: string; cause?: unknown };

async function attemptOnce<T>(
  endpoint: string,
  operation: string,
  query: string,
  variables: Record<string, unknown>,
  policy: RetryPolicy,
): Promise<Attempt<T>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("timeout")), policy.timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      // Indexer reads are point-in-time; never let a framework cache serve a
      // stale book into a risk verdict. `cache` is absent from @types/node's
      // RequestInit but is honoured by Node's fetch and by Next.js, which is the
      // runtime that actually caches — hence the widened type rather than a drop.
      cache: "no-store",
      signal: ac.signal,
    } as RequestInit & { cache?: string });

    // 4xx is our bug (bad query, bad auth) and will fail identically forever.
    // 5xx and 429 are the server's problem and may well pass next time.
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429;
      return { ok: false, retryable, reason: `HTTP ${res.status}` };
    }

    // A truncated or HTML (edge/proxy error page) body lands here. Retryable:
    // this is the exact `response was not JSON` failure observed in the wild.
    let json: { data?: T; errors?: { message?: string }[] };
    try {
      json = (await res.json()) as typeof json;
    } catch (cause) {
      return { ok: false, retryable: true, reason: "response was not JSON", cause };
    }

    const gqlError = json.errors?.[0];
    if (gqlError) {
      // Hasura validation errors are deterministic — a misspelled field will
      // never resolve. Surface immediately rather than burning four attempts.
      return {
        ok: false,
        retryable: false,
        reason: gqlError.message ?? "unknown GraphQL error",
      };
    }
    if (json.data === undefined || json.data === null) {
      return { ok: false, retryable: true, reason: "response carried no data" };
    }
    return { ok: true, data: json.data };
  } catch (cause) {
    const code =
      cause && typeof cause === "object" && "cause" in cause
        ? ((cause as { cause?: { code?: string } }).cause?.code ?? undefined)
        : undefined;
    const reason = code ?? (cause instanceof Error ? cause.message : String(cause));
    // Network-layer failures (ETIMEDOUT, ECONNRESET, ENETUNREACH, abort) are all
    // worth another try.
    return { ok: false, retryable: true, reason, cause };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a GraphQL query with retry + backoff.
 *
 * @throws {@link IndexerRejected} on a query the server will never accept.
 * @throws {@link IndexerUnavailable} when every attempt failed transiently.
 */
export async function query<T>(
  endpoint: string,
  operation: string,
  gql: string,
  variables: Record<string, unknown> = {},
  policy: RetryPolicy = DEFAULT_RETRY,
): Promise<T> {
  let last = "no attempt made";
  let lastCause: unknown;

  for (let i = 0; i < policy.attempts; i++) {
    const result = await attemptOnce<T>(endpoint, operation, gql, variables, policy);
    if (result.ok) return result.data;

    if (!result.retryable) throw new IndexerRejected(operation, result.reason);
    last = result.reason;
    lastCause = result.cause;
    if (i < policy.attempts - 1) await sleep(backoffMs(i, policy));
  }

  throw new IndexerUnavailable(operation, policy.attempts, last, { cause: lastCause });
}

/**
 * The same call, but a transient failure resolves to `null` instead of throwing.
 *
 * For the dashboard: one degraded panel should not blank the page. A `null` here
 * means "show this as stale/unavailable", and is deliberately distinct from an
 * empty result, which means "the venue really has none of these".
 */
export async function queryOrNull<T>(
  endpoint: string,
  operation: string,
  gql: string,
  variables: Record<string, unknown> = {},
  policy: RetryPolicy = DEFAULT_RETRY,
): Promise<T | null> {
  try {
    return await query<T>(endpoint, operation, gql, variables, policy);
  } catch (e) {
    if (e instanceof IndexerRejected) throw e; // our bug — do not paper over it
    return null;
  }
}
