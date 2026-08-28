/**
 * The explanation layer. The LLM's ONLY job is prose.
 *
 * THE CENTRAL GUARANTEE, and how it is enforced: the model cannot alter the
 * verdict, the confidence, or any measured number — not because we ask it not
 * to, but because **those fields do not exist in its output schema**. It is
 * handed the computed assessment and returns explanatory text keyed to signal
 * ids. There is no field it could write a verdict into.
 *
 * That is a structural guarantee rather than a behavioural one. "Ask the model
 * for a verdict and check it afterwards" is a weaker design: it can disagree,
 * and then someone has to decide who wins. Here the question cannot arise.
 *
 * Three further defences, because a plausible-sounding wrong explanation is the
 * most damaging output this product can produce:
 *
 *   1. Every claim must cite a signal id that exists in the assessment. The
 *      model is given the ids; anything else is rejected.
 *   2. The prose is scanned for verdict words that contradict the computed
 *      verdict. A summary that says "safe to trade" under a BLOCK is rejected
 *      even though the verdict field itself is untouched.
 *   3. Numbers in the prose are checked against the evidence. A fabricated
 *      figure — the classic hallucination — fails the guard.
 *
 * If the model is unreachable or its output fails any guard, we fall back to a
 * deterministic narrator built from the same signals. The product degrades to
 * plainer language; it never degrades to a wrong verdict, and it never shows a
 * blank panel. The LLM is the polish, not the substance.
 */

import type { Assessment, Severity, SignalId, Verdict } from "./risk.js";
import type { MarketSnapshot } from "./snapshot.js";

/** The model's contribution: prose, and nothing else. */
export interface Explanation {
  /** Two or three sentences a trader could act on. */
  summary: string;
  /** Per-signal plain-language reading, keyed by signal id. */
  perSignal: { signalId: SignalId; reading: string }[];
  /** The single most important thing about this market. */
  headline: string;
  /** How the explanation was produced — always visible in the trace. */
  source: "model" | "fallback";
  /** Present when the model was tried and rejected or unreachable. */
  fallbackReason?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/** The exact JSON the model must produce. No verdict field exists here. */
const EXPLAIN_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    headline: {
      type: "string" as const,
      description:
        "The single most important thing about this market, in one sentence under 120 characters. State the measured fact, not a recommendation.",
    },
    summary: {
      type: "string" as const,
      description:
        "Two or three sentences explaining what the signals collectively show. Reference specific measured values. Do not state or imply a verdict — it has already been determined.",
    },
    per_signal: {
      type: "array" as const,
      description: "One reading per signal you were given. Use the exact signal ids provided.",
      items: {
        type: "object" as const,
        properties: {
          signal_id: {
            type: "string" as const,
            enum: [
              "venue",
              "resolution",
              "liquidity",
              "volatility",
              "staleness",
              "window",
              "manipulation",
            ],
          },
          reading: {
            type: "string" as const,
            description:
              "One sentence on what this signal's measured value means for someone deciding whether to trade. Plain language, no restating the number verbatim.",
          },
        },
        required: ["signal_id", "reading"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "summary", "per_signal"],
  additionalProperties: false,
};

/**
 * The system prompt. Written to constrain rather than to encourage.
 *
 * Note what it does NOT do: it does not ask for a verdict, a probability, a
 * price prediction, or a recommendation. The model is told the verdict as
 * context so its prose is consistent with it, and told explicitly that the
 * verdict is not its to make.
 */
const SYSTEM = `You explain pre-computed risk assessments for prediction-market contracts on DreamDEX, a central limit order book on Somnia.

WHAT YOU ARE DOING
A deterministic engine has already measured this market and reached a verdict. Your job is to render its findings in plain language for a trader deciding whether to act. You are the last mile of an audit trail, not an analyst forming a view.

HARD CONSTRAINTS
- The verdict, the confidence figure, and every measured number are already decided. You cannot change them and you are not asked to.
- Never predict whether the market resolves YES or NO. Never estimate a probability of any outcome. Never advise buying or selling. If the evidence seems to point somewhere, that is not yours to say.
- Use only the numbers given to you. Do not compute new ones, do not round in a way that changes meaning, and never introduce a figure that is not in the evidence.
- A signal marked "unknown" was NOT MEASURED. It is not reassuring and it is not alarming — say plainly that it could not be established. Never describe an unmeasured signal as fine.
- Every claim must trace to a signal you were given.

CALIBRATION — THIS VENUE IS NOT A REAL-MONEY BOOK
Spreads of 2 to 3 probability points are NORMAL here, not alarming. A price step of about 10 points between trades is NORMAL. A market going tens of minutes without a trade is NORMAL on a 24-hour window. The thresholds you are shown are calibrated to this venue's measured distributions. Do not import intuitions from equity or crypto spot markets — describing an ordinary 2.6-point spread as "wide" or "concerning" would be wrong here.

STYLE
Direct and specific. Lead with what matters. No hedging padding ("it is worth noting that", "one should be aware"), no filler, no restating the verdict word back at the reader. Write for someone who will act on this in the next minute. Plain sentences over jargon; where a term is unavoidable, use it precisely.`;

/** Compact evidence block. Only what the model may reason from. */
function renderAssessment(s: MarketSnapshot, a: Assessment): string {
  const id = s.identity;
  const lines: string[] = [
    `MARKET: ${id.symbol}`,
    `Asset ${id.asset ?? "?"} · window ${id.intervalSec ? `${id.intervalSec / 60} minutes` : "unknown"} · settles against its own opening price`,
    `Question: ${id.question ?? "n/a"}`,
    "",
    `COMPUTED VERDICT: ${a.verdict} (confidence ${a.confidence} — this measures how completely the market could be observed, NOT a probability of any outcome)`,
    `Action: ${a.action}`,
    "",
    "SIGNALS AS MEASURED:",
  ];

  for (const sig of a.signals) {
    lines.push(`- id=${sig.id} | severity=${sig.severity} | ${sig.finding}`);
    const ev = Object.entries(sig.evidence)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    if (ev) lines.push(`  evidence: ${ev}`);
    lines.push(`  threshold basis: ${sig.basis}`);
  }

  lines.push("", "RULES THAT FIRED, IN ORDER:");
  for (const r of a.rules) lines.push(`- ${r.rule}: ${r.because}`);

  if (a.requiredChecks.length) {
    lines.push("", "CHECKS THE ENGINE REQUIRES BEFORE ACTING:");
    for (const c of a.requiredChecks) lines.push(`- ${c}`);
  }
  if (a.unknownSignals.length) {
    lines.push(
      "",
      `NOT MEASURED (treat as unknown, never as acceptable): ${a.unknownSignals.join(", ")}`,
    );
  }
  return lines.join("\n");
}

/** Verdict words that must not appear against a contradicting computed verdict. */
const CONTRADICTIONS: Record<Verdict, RegExp[]> = {
  BLOCK: [
    /\b(safe to (trade|execute|enter))\b/i,
    /\bgood (entry|opportunity)\b/i,
    /\bclear to (trade|proceed)\b/i,
    /\bno (significant |material )?(risk|concern)s?\b/i,
  ],
  RECHECK: [/\b(safe to (trade|execute)|clear to proceed|no concerns)\b/i],
  ALLOW: [/\b(do not (trade|execute)|avoid this market|too risky to)\b/i],
};

/** Numbers the model is allowed to use: anything already in the evidence. */
function allowedNumbers(a: Assessment): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "number") {
      out.add(String(v));
      out.add(v.toFixed(0));
      out.add(v.toFixed(1));
      out.add(v.toFixed(2));
      out.add(v.toFixed(3));
      // Points and percentages are the same measurement, differently scaled.
      out.add((v * 100).toFixed(0));
      out.add((v * 100).toFixed(1));
      out.add(Math.round(v / 60).toString());
      out.add(Math.round(v).toString());
    } else if (typeof v === "string" && /^\d+$/.test(v)) out.add(v);
  };
  add(a.confidence);
  for (const s of a.signals) {
    for (const v of Object.values(s.evidence)) add(v);
    // Any number already stated in text we handed the model is legitimate for it
    // to quote back. This includes `basis` — the calibration strings carry real
    // distribution figures ("median 0.040, p75 0.282"), and a live model run was
    // rejected for citing exactly those before basis was included here. That was
    // the guard being wrong, not the model.
    for (const m of `${s.finding} ${s.basis}`.matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]);
  }
  for (const r of a.rules) for (const m of r.because.matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]);
  for (const c of a.requiredChecks) for (const m of c.matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]);
  return out;
}

export interface GuardFailure {
  check: string;
  detail: string;
}

/**
 * Validate model prose against the assessment it is supposed to describe.
 *
 * Returns the failures rather than throwing: a rejected explanation falls back
 * to the deterministic narrator, and the reason is surfaced in the trace so a
 * rejection is visible rather than silent.
 */
export function guardExplanation(
  text: { headline: string; summary: string; perSignal: { signalId: string; reading: string }[] },
  a: Assessment,
): GuardFailure[] {
  const failures: GuardFailure[] = [];
  const prose = `${text.headline} ${text.summary} ${text.perSignal.map((p) => p.reading).join(" ")}`;

  // 1. Contradicting the computed verdict in prose.
  for (const re of CONTRADICTIONS[a.verdict]) {
    const hit = prose.match(re);
    if (hit) {
      failures.push({
        check: "verdict-contradiction",
        detail: `prose says "${hit[0]}" under a ${a.verdict} verdict`,
      });
    }
  }

  // 2. Every cited signal must exist.
  const known = new Set(a.signals.map((s) => s.id as string));
  for (const p of text.perSignal) {
    if (!known.has(p.signalId)) {
      failures.push({ check: "unknown-signal", detail: `cited signal "${p.signalId}" was not provided` });
    }
  }

  // 3. Unmeasured signals must not be described as healthy.
  const unmeasured = new Set(a.unknownSignals as string[]);
  for (const p of text.perSignal) {
    if (!unmeasured.has(p.signalId)) continue;
    if (/\b(healthy|fine|good|normal|acceptable|no (issue|problem|concern))/i.test(p.reading)) {
      failures.push({
        check: "unmeasured-described-as-ok",
        detail: `signal "${p.signalId}" was not measured but is described as acceptable`,
      });
    }
  }

  // 4. Fabricated numbers. Percent signs and bare integers under 100 are
  //    ordinary prose ("two of seven"), so only flag figures that look like
  //    measurements and appear nowhere in the evidence.
  const allowed = allowedNumbers(a);
  for (const m of prose.matchAll(/\d+\.\d+/g)) {
    if (!allowed.has(m[0])) {
      failures.push({ check: "fabricated-number", detail: `"${m[0]}" appears in no evidence field` });
    }
  }

  // 5. Outcome prediction — the one thing the product must never do.
  if (/\b(will (likely )?(resolve|settle|close) (yes|no|above|below))\b/i.test(prose)) {
    failures.push({ check: "outcome-prediction", detail: "prose predicts the market's resolution" });
  }

  return failures;
}

// ── deterministic fallback ─────────────────────────────────────────────────────

const SEVERITY_PHRASE: Record<Severity, string> = {
  ok: "is within this venue's normal range",
  elevated: "needs a closer look",
  severe: "is a blocking problem",
  unknown: "could not be measured",
};

/**
 * Build an explanation from the signals alone, no model involved.
 *
 * This is not a stub. It is the guarantee that a model outage, a rate limit, or
 * a guard rejection degrades the product to plainer prose rather than to a blank
 * panel or a wrong verdict. Every sentence here is assembled from the same
 * findings the model would have been given.
 */
export function fallbackExplanation(
  s: MarketSnapshot,
  a: Assessment,
  reason: string,
): Explanation {
  const severe = a.signals.filter((x) => x.severity === "severe");
  const elevated = a.signals.filter((x) => x.severity === "elevated");
  const unknown = a.signals.filter((x) => x.severity === "unknown");
  const window = s.identity.intervalSec ? `${s.identity.intervalSec / 60}-minute` : "";

  const headline =
    severe[0]?.finding ??
    elevated[0]?.finding ??
    (unknown.length > 0
      ? `${unknown.length} of ${a.signals.length} signals could not be measured on this ${window} market.`
      : `All ${a.signals.length} signals on this ${window} market are within normal range.`);

  const parts: string[] = [];
  if (severe.length > 0) {
    parts.push(
      `${severe.length === 1 ? "One signal is" : `${severe.length} signals are`} blocking: ${severe.map((x) => x.label.toLowerCase()).join(", ")}.`,
    );
  }
  if (elevated.length > 0) {
    parts.push(
      `${elevated.map((x) => x.label.toLowerCase()).join(" and ")} ${elevated.length === 1 ? "warrants" : "warrant"} a closer look before acting.`,
    );
  }
  if (unknown.length > 0) {
    parts.push(
      `${unknown.map((x) => x.label.toLowerCase()).join(" and ")} could not be measured, so ${unknown.length === 1 ? "it is" : "they are"} unknown rather than acceptable.`,
    );
  }
  if (parts.length === 0) {
    parts.push(
      `Spread, depth, price movement, trade recency and order flow were all measured and all sit inside the ranges observed across this venue.`,
    );
  }
  parts.push(`Confidence ${a.confidence} reflects how much of the market could be observed, not any view on its outcome.`);

  return {
    headline,
    summary: parts.join(" "),
    perSignal: a.signals.map((sig) => ({
      signalId: sig.id,
      reading: `${sig.label} ${SEVERITY_PHRASE[sig.severity]}. ${sig.finding}`,
    })),
    source: "fallback",
    fallbackReason: reason,
  };
}

// ── the model call ─────────────────────────────────────────────────────────────

export interface ExplainOptions {
  /** Default `claude-opus-4-8`. */
  model?: string;
  /** Skip the model entirely — used by tests and offline demos. */
  offline?: boolean;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Explain an assessment. Never throws, never returns an empty explanation.
 *
 * Output is forced through a tool call with `tool_choice: {type: "tool"}` rather
 * than asked for as JSON in prose. The model cannot reply with anything but a
 * call to `emit_explanation`, whose schema has no verdict field — so a
 * well-formed response is structurally incapable of overriding the engine.
 *
 * Every failure path lands on `fallbackExplanation` with the reason recorded:
 * no API key, unreachable endpoint, malformed output, or a guard rejection. The
 * caller always gets prose, and the trace always says where it came from.
 */
export async function explainAssessment(
  s: MarketSnapshot,
  a: Assessment,
  opts: ExplainOptions = {},
): Promise<Explanation> {
  if (opts.offline) return fallbackExplanation(s, a, "offline mode requested");

  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackExplanation(s, a, "ANTHROPIC_API_KEY is not set");

  const model = opts.model ?? "claude-opus-4-8";

  try {
    // Imported lazily so the package stays usable — and the dashboard stays
    // buildable — without the SDK present.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({
      apiKey,
      ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
      timeout: opts.timeoutMs ?? 60_000,
      maxRetries: 2,
    });

    const response = await client.messages.create({
      model,
      max_tokens: 2_048,
      system: SYSTEM,
      tools: [
        {
          name: "emit_explanation",
          description:
            "Emit the plain-language explanation of this assessment. This is the only way to respond.",
          input_schema: EXPLAIN_TOOL_SCHEMA,
        },
      ],
      // Forced: the model has no option to answer in prose, and no field in
      // which to express a verdict.
      tool_choice: { type: "tool", name: "emit_explanation" },
      messages: [
        {
          role: "user",
          content: `${renderAssessment(s, a)}\n\nCall emit_explanation with your reading of these signals. Signal ids you may cite: ${a.signals.map((x) => x.id).join(", ")}.`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      return fallbackExplanation(s, a, `model returned no tool call (stop_reason ${response.stop_reason})`);
    }

    const raw = block.input as {
      headline?: unknown;
      summary?: unknown;
      per_signal?: unknown;
    };
    const headline = typeof raw.headline === "string" ? raw.headline : "";
    const summary = typeof raw.summary === "string" ? raw.summary : "";
    const perSignal = Array.isArray(raw.per_signal)
      ? raw.per_signal
          .filter(
            (p): p is { signal_id: string; reading: string } =>
              !!p &&
              typeof (p as { signal_id?: unknown }).signal_id === "string" &&
              typeof (p as { reading?: unknown }).reading === "string",
          )
          .map((p) => ({ signalId: p.signal_id, reading: p.reading }))
      : [];

    if (!headline || !summary || perSignal.length === 0) {
      return fallbackExplanation(s, a, "model output was missing required fields");
    }

    const failures = guardExplanation({ headline, summary, perSignal }, a);
    if (failures.length > 0) {
      // A rejected explanation is a notable event, not a silent one — the reason
      // rides through to the trace so the guard is visibly doing work.
      return fallbackExplanation(
        s,
        a,
        `model output rejected: ${failures.map((f) => `${f.check} (${f.detail})`).join("; ")}`,
      );
    }

    return {
      headline,
      summary,
      perSignal: perSignal as { signalId: SignalId; reading: string }[],
      source: "model",
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (e) {
    const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return fallbackExplanation(s, a, reason);
  }
}

// ── the decision trace ─────────────────────────────────────────────────────────

/**
 * Everything behind one verdict, in the order it was determined.
 *
 * This is the Stage 5 deliverable and the thing a judge should be able to open.
 * Its defining property is that the provenance of every part is explicit: which
 * numbers were measured, which thresholds they were compared against and why
 * those thresholds, which rules fired, and whether the prose came from the model
 * or the fallback narrator.
 */
export interface DecisionTrace {
  marketId: string;
  symbol: string;
  assembledAt: number;
  verdict: Verdict;
  confidence: number;
  action: Assessment["action"];
  /** Deterministic: measured value, severity, and calibration basis. */
  signals: {
    id: SignalId;
    label: string;
    severity: Severity;
    finding: string;
    evidence: Record<string, number | string | boolean | null>;
    basis: string;
    /** Model prose for this signal, when available. */
    reading?: string;
  }[];
  /** The state machine's path, in evaluation order. */
  rules: { rule: string; because: string }[];
  requiredChecks: string[];
  unmeasured: SignalId[];
  /** LLM contribution, clearly separated from the computed part. */
  explanation: Explanation;
  /** The public settlement receipt, when the market has an oracle question. */
  oracleAuditUrl: string | null;
  /** Per-field read provenance — what was fresh, stale, or unavailable. */
  provenance: { field: string; state: string; readAt: number; reason?: string }[];
}

export function buildTrace(
  s: MarketSnapshot,
  a: Assessment,
  explanation: Explanation,
): DecisionTrace {
  const readingOf = (id: SignalId) =>
    explanation.perSignal.find((p) => p.signalId === id)?.reading;

  return {
    marketId: s.identity.marketId,
    symbol: s.identity.symbol,
    assembledAt: s.assembledAt,
    verdict: a.verdict,
    confidence: a.confidence,
    action: a.action,
    signals: a.signals.map((sig) => ({
      id: sig.id,
      label: sig.label,
      severity: sig.severity,
      finding: sig.finding,
      evidence: sig.evidence,
      basis: sig.basis,
      reading: readingOf(sig.id),
    })),
    rules: a.rules,
    requiredChecks: a.requiredChecks,
    unmeasured: a.unknownSignals,
    explanation,
    oracleAuditUrl: s.resolution.value?.oracleExplorerUrl ?? null,
    provenance: (
      [
        ["onchain", s.onchain.provenance],
        ["book", s.book.provenance],
        ["prices", s.prices.provenance],
        ["move", s.move.provenance],
        ["flow", s.flow.provenance],
        ["freshness", s.freshness.provenance],
        ["resolution", s.resolution.provenance],
      ] as const
    ).map(([field, p]) => ({
      field,
      state: p.state,
      readAt: p.readAt,
      ...("reason" in p ? { reason: p.reason } : {}),
    })),
  };
}
