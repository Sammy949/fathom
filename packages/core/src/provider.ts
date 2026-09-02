/**
 * Provider adapter for the explanation layer.
 *
 * WHY THIS EXISTS: the repo must not depend on any one account's plumbing. A
 * judge cloning this should be able to run it with their own free key, or with
 * no key at all. So the provider is chosen by `.env` and nothing about it is
 * hardcoded here or written into the notes.
 *
 * Two shapes are supported, which between them cover most of the market:
 *
 *   groq       — Groq's OpenAI-compatible chat-completions API. The same call
 *                shape works for OpenRouter, Together, Cerebras, DeepSeek,
 *                Fireworks and local Ollama; point LLM_BASE_URL at any of them.
 *   anthropic  — the Anthropic Messages API, if a key is present.
 *
 * The two differ in how structured output is forced, and the difference matters:
 *
 *   Anthropic  `tool_choice: {type: "tool"}` — the model cannot reply with
 *              anything but a call to our schema.
 *   Groq       `response_format: {type: "json_schema", strict: true}` —
 *              constrained decoding, so the JSON is schema-valid by construction.
 *              Verified against Groq's docs: strict mode requires every property
 *              in `required` and `additionalProperties: false` on every object,
 *              and is supported on the GPT-OSS models. Groq also documents that
 *              structured outputs and tool use are mutually exclusive, so the
 *              tool-call route is not available there — hence two paths rather
 *              than one.
 *
 * Both routes give the same guarantee for the same reason: the schema has no
 * verdict field, so a well-formed response structurally cannot override the
 * engine. The guarantee lives in the schema, not in the provider — which is
 * exactly why swapping providers is safe.
 *
 * A weaker model is fine here. The four guards in explain.ts plus the
 * deterministic fallback mean malformed or dishonest prose is rejected and
 * narrated deterministically rather than shipped. The safety property does not
 * depend on the model being good.
 */

export type ProviderKind = "groq" | "anthropic";

export interface ProviderConfig {
  kind: ProviderKind;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Groq's default. `openai/gpt-oss-120b` is a production model with 131k context
 * that supports `strict: true` structured outputs (verified against Groq's
 * supported-models table, 2026-08-28). `llama-3.3-70b-versatile` does NOT
 * support strict mode — it would fall back to best-effort JSON, which the guards
 * would then have to catch. Prefer the model where the schema is enforced.
 */
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const ANTHROPIC_DEFAULT_MODEL = "claude-opus-4-8";

/**
 * Resolve the provider from the environment.
 *
 * Groq is checked first and is the documented default: free tier, no card, and
 * fast enough that a live demo does not stall. Returns null when no key is
 * present at all — the caller then uses the deterministic narrator, which is a
 * supported mode rather than a failure.
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): ProviderConfig | null {
  const explicit = (env.LLM_PROVIDER ?? "").trim().toLowerCase();

  const groqKey = (env.GROQ_API_KEY ?? "").trim();
  if (groqKey && (explicit === "groq" || explicit === "")) {
    return {
      kind: "groq",
      apiKey: groqKey,
      // Any OpenAI-compatible endpoint works here — that is the point of the
      // override rather than an accident of it.
      baseUrl: (env.LLM_BASE_URL ?? GROQ_BASE_URL).replace(/\/+$/, ""),
      model: env.LLM_MODEL ?? GROQ_DEFAULT_MODEL,
    };
  }

  const anthropicKey = (env.ANTHROPIC_API_KEY ?? "").trim();
  if (anthropicKey && (explicit === "anthropic" || explicit === "")) {
    return {
      kind: "anthropic",
      apiKey: anthropicKey,
      baseUrl: (env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, ""),
      model: env.LLM_MODEL ?? ANTHROPIC_DEFAULT_MODEL,
    };
  }

  if (explicit === "groq") return null;
  if (explicit === "anthropic") return null;
  return null;
}

/** What a provider returns. Prose in, prose out — no verdict, by construction. */
export interface ProviderResult {
  /** Raw JSON object matching the requested schema. */
  output: Record<string, unknown>;
  /** Model name as reported by the provider, not as requested. */
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ProviderRequest {
  system: string;
  user: string;
  /** JSON Schema the output must satisfy. Must have no verdict field. */
  schema: Record<string, unknown>;
  schemaName: string;
  /** Description of what the schema is for — used as the tool description. */
  schemaDescription: string;
  maxTokens?: number;
  timeoutMs?: number;
}

const withTimeout = (ms: number) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`timed out after ${ms}ms`)), ms);
  return { signal: ac.signal, done: () => clearTimeout(timer) };
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * How long a 429 says to wait, in ms.
 *
 * Groq is unusually helpful here: the body carries "Please try again in 4.965s"
 * and the standard `retry-after` header. Honouring it turns a hard failure into
 * a short pause rather than a fallback.
 *
 * IT ALSO SAYS "412.5ms", and that is why the unit is matched explicitly. The
 * original pattern was `/try again in ([\d.]+)s/i`, whose trailing `s` happily
 * matched the `s` of `ms` — so a 0.4-SECOND wait was read as 412 seconds, blew
 * past the cap, and the retry was skipped entirely. The market fell back to the
 * narrator because the parser inflated the wait by a thousand.
 */
export function retryAfterMsFrom(body: string, retryAfterHeader: string | null): number | null {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs)) return Math.ceil(secs * 1000);
  }
  const m = body.match(/try again in\s*([\d.]+)\s*(ms|s)\b/i);
  if (m?.[1]) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) return null;
    return Math.ceil(m[2]?.toLowerCase() === "ms" ? value : value * 1000);
  }
  return null;
}

const retryAfterMs = (body: string, headers: Headers): number | null =>
  retryAfterMsFrom(body, headers.get("retry-after"));

/**
 * Groq / any OpenAI-compatible endpoint, via `response_format: json_schema`.
 *
 * Uses `fetch` rather than an SDK on purpose: it is one HTTP call, and adding a
 * dependency to shape one POST body would be the larger cost. It also means the
 * same code path works against every OpenAI-compatible provider without a
 * per-provider client.
 *
 * Retries twice, on three different conditions:
 *   429 — wait exactly as long as the provider asks (Groq states it in the body
 *         and in `retry-after`), then try again.
 *   transport failure — `TypeError: fetch failed`, ETIMEDOUT and friends. Same
 *         WSL/IPv6 flakiness that made the indexer reads unreliable; measured
 *         here as roughly 1 market in 3 on some runs.
 *   a truncated generation — see `isRetryableGenerationFailure`.
 *
 * Everything else fails immediately. A 400 is normally our schema being wrong and
 * no number of attempts will fix it, so burning retries would only delay the real
 * error.
 */

/**
 * True for the one 400 that is NOT our bug.
 *
 * Groq returns `code: "json_validate_failed"` when its own constrained decoding
 * produces JSON that fails the schema — "missing properties: 'summary'". Strict
 * mode is supposed to make that impossible, and the reason it happens anyway is
 * `max_completion_tokens`: the generation runs into the ceiling and the object is
 * cut off before its last property. Measured on successful runs, output billed at
 * 1,171 / 1,176 / 1,396 tokens against a 1,400 ceiling — the longest explanations
 * sit ON the cap, so the next one over it truncates.
 *
 * That is transient in exactly the way a 429 is: the same request will usually
 * succeed, because the next generation is a little shorter. Raising the ceiling
 * would instead spend the increase on EVERY call, since Groq bills the ceiling as
 * requested rather than as used, and three calls already exceed the 8,000 TPM
 * budget. So it is retried and the cap stays honest.
 *
 * Exported for the same reason `retryAfterMsFrom` is: this classification was
 * silently wrong once already, and a retry rule that is not asserted is a guess.
 */
export function isRetryableGenerationFailure(status: number, body: string): boolean {
  return status === 400 && body.includes("json_validate_failed");
}
async function callOpenAICompatible(
  cfg: ProviderConfig,
  req: ProviderRequest,
  attempt = 0,
): Promise<ProviderResult> {
  const maxAttempts = 3;
  const { signal, done } = withTimeout(req.timeoutMs ?? 60_000);
  try {
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: cfg.model,
          // Counts against TPM as REQUESTED, not as used — so an inflated
          // ceiling costs quota on every call. Observed output is ~1,200 tokens.
          max_completion_tokens: req.maxTokens ?? 1_400,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: req.schemaName,
              // Constrained decoding: the response is schema-valid by
              // construction rather than by the model choosing to comply.
              strict: true,
              schema: req.schema,
            },
          },
        }),
        signal,
      });
    } catch (transportError) {
      if (attempt + 1 < maxAttempts) {
        done();
        await sleep(400 * 2 ** attempt + Math.random() * 300);
        return callOpenAICompatible(cfg, req, attempt + 1);
      }
      throw transportError;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // A rate limit is a wait, not a failure — and Groq tells us exactly how
      // long. A second 429 after waiting means the budget is genuinely spent.
      if (res.status === 429 && attempt + 1 < maxAttempts) {
        const waitMs = retryAfterMs(body, res.headers);
        // Cap at 45s, not 30s. The TPM window is a minute, so any wait shorter
        // than one is legitimately worth taking — and a 30s cap rejected the
        // real-world case by 400ms: Groq asked for 30.405s once the eighth
        // signal grew the prompt, the retry was skipped, and the market fell
        // back to the narrator for the sake of four hundred milliseconds.
        if (waitMs !== null && waitMs <= 45_000) {
          done();
          await sleep(waitMs + 250);
          return callOpenAICompatible(cfg, req, attempt + 1);
        }
      }
      // A truncated generation is transient in the same way: retry rather than
      // reporting the model's own cut-off object as a schema error of ours.
      if (isRetryableGenerationFailure(res.status, body) && attempt + 1 < maxAttempts) {
        done();
        await sleep(300 * 2 ** attempt + Math.random() * 200);
        return callOpenAICompatible(cfg, req, attempt + 1);
      }
      // Surface the provider's own message — a 400 here is usually a schema
      // Groq's strict mode rejects, and the detail says which part.
      throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
    }

    const json = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("response carried no message content");

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`message content was not JSON: ${content.slice(0, 200)}`);
    }
    if (!parsed || typeof parsed !== "object") throw new Error("message content was not an object");

    return {
      output: parsed as Record<string, unknown>,
      model: json.model ?? cfg.model,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  } finally {
    done();
  }
}

/** Anthropic Messages API, via a forced tool call. */
async function callAnthropic(
  cfg: ProviderConfig,
  req: ProviderRequest,
): Promise<ProviderResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl,
    timeout: req.timeoutMs ?? 60_000,
    maxRetries: 2,
  });

  const response = await client.messages.create({
    model: cfg.model,
    max_tokens: req.maxTokens ?? 2_048,
    system: req.system,
    tools: [
      {
        name: req.schemaName,
        description: req.schemaDescription,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_schema: req.schema as any,
      },
    ],
    // Forced: no option to answer in prose, and no field for a verdict.
    tool_choice: { type: "tool", name: req.schemaName },
    messages: [{ role: "user", content: req.user }],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error(`no tool call in response (stop_reason ${response.stop_reason})`);
  }
  return {
    output: block.input as Record<string, unknown>,
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

/** Dispatch to the resolved provider. Throws; the caller owns the fallback. */
export function callProvider(cfg: ProviderConfig, req: ProviderRequest): Promise<ProviderResult> {
  return cfg.kind === "anthropic" ? callAnthropic(cfg, req) : callOpenAICompatible(cfg, req);
}

/** Human-readable provider label for the trace. Never includes the key. */
export const describeProvider = (cfg: ProviderConfig): string =>
  `${cfg.kind}:${cfg.model}`;
