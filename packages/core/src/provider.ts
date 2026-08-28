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

/**
 * Groq / any OpenAI-compatible endpoint, via `response_format: json_schema`.
 *
 * Uses `fetch` rather than an SDK on purpose: it is one HTTP call, and adding a
 * dependency to shape one POST body would be the larger cost. It also means the
 * same code path works against every OpenAI-compatible provider without a
 * per-provider client.
 */
async function callOpenAICompatible(
  cfg: ProviderConfig,
  req: ProviderRequest,
): Promise<ProviderResult> {
  const { signal, done } = withTimeout(req.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_completion_tokens: req.maxTokens ?? 2_048,
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

    if (!res.ok) {
      const body = await res.text().catch(() => "");
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
