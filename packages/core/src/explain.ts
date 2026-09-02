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

import { SIGNAL_IDS, type Assessment, type Severity, type SignalId, type Verdict } from "./risk";
import type { MarketSnapshot } from "./snapshot";
import {
  callProvider,
  describeProvider,
  resolveProvider,
  type ProviderConfig,
} from "./provider";

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
        "Two or three sentences explaining what the signals collectively show. Reference specific measured values. Do not state or imply a verdict; it has already been determined.",
    },
    per_signal: {
      type: "array" as const,
      description: "One reading per signal you were given. Use the exact signal ids provided.",
      items: {
        type: "object" as const,
        properties: {
          signal_id: {
            type: "string" as const,
            // Derived, never hand-copied. A duplicated list here went out of sync
            // the moment `depth` was added: Groq's strict decoding rejected every
            // response, all three markets silently fell back to the deterministic
            // narrator, and the gate still passed because the fallback works as
            // designed. Only the fallback-reason field showed it.
            enum: [...SIGNAL_IDS],
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
  // Every property listed in `required` and `additionalProperties: false` on
  // every object — both are hard requirements of Groq's strict mode, and
  // Anthropic's tool schema accepts the same shape. One schema, both providers.
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
- NUMBERS MUST BE COPIED VERBATIM. If you cite a figure, copy it exactly as it is written in the finding or evidence you were given. Do NOT convert units (seconds to minutes, points to percent), do NOT rescale, do NOT round, and do NOT compute anything new: not an average, not a ratio, not a difference. An automated check rejects any figure that does not appear verbatim in your inputs, and a rejected explanation is discarded entirely. When a quantity would read better in other units, describe it in words instead ("over half the window", "most of the way to expiry") rather than doing the arithmetic.
- A signal marked "unknown" was NOT MEASURED. It is not reassuring and it is not alarming. Say plainly that it could not be established. Never describe an unmeasured signal as fine.
- Every claim must trace to a signal you were given.

CALIBRATION — THIS VENUE IS NOT A REAL-MONEY BOOK
Spreads of 2 to 3 probability points are NORMAL here, not alarming. A price step of about 10 points between trades is NORMAL. A market going tens of minutes without a trade is NORMAL on a 24-hour window. The thresholds you are shown are calibrated to this venue's measured distributions. Do not import intuitions from equity or crypto spot markets; describing an ordinary 2.6-point spread as "wide" or "concerning" would be wrong here.

STYLE
Direct and specific. Lead with what matters. No hedging padding ("it is worth noting that", "one should be aware"), no filler, no restating the verdict word back at the reader. Write for someone who will act on this in the next minute. Plain sentences over jargon; where a term is unavoidable, use it precisely.

WRITE FOR A PERSON, NOT FOR A LOG
The inputs below are machine records. Your output is a sentence someone reads. Those are not the same register, and the difference is not cosmetic.
- NEVER write a field name. Not "lastTradeAgeSec=103", not "windowElapsed=0.448", not "severity=unknown", not "(liquidity severity=unknown)". Say "the last trade was 103 seconds ago" or "45% of the window has elapsed". A reader has never seen our schema and should not have to.
- NEVER write an identifier: no 0x addresses, no venue ids, no market ids. They are 66 characters of hex that tell a reader nothing and crowd out what does.
- NEVER write our internal signal ids in prose. In your per-signal readings the id belongs ONLY in the signal_id field. If you name a signal in a sentence, use its human label: "order flow" not "manipulation", "depth durability" not "depth".
- No key=value pairs, no parenthetical field dumps, no unit suffixes lifted off a variable name ("Sec", "Ns", "Pct").
The figures themselves must still be copied verbatim, exactly as the rule above requires. It is the SCAFFOLDING that is banned, never the number.

PER-SIGNAL READINGS MUST ADD SOMETHING
Each signal already arrives with a finding written in plain language. Do not paraphrase it back. If you have nothing to add beyond what the finding says, return an EMPTY reading for that signal; an empty reading is correct and expected, and it is strictly better than a restatement. Write a reading only where you can say something the finding does not: what it implies for acting now, how two signals interact, or why an unmeasured signal matters here.`;

/** Compact evidence block. Only what the model may reason from. */
function renderAssessment(s: MarketSnapshot, a: Assessment): string {
  const id = s.identity;
  const lines: string[] = [
    // The symbol, not the marketId or the venueId. Neither identifier tells the
    // model anything it can reason from, and sending them is what put a
    // 66-character hex string in a sentence a human was meant to read.
    `MARKET: ${id.symbol}`,
    `Asset ${id.asset ?? "?"} · window ${id.intervalSec ? `${id.intervalSec / 60} minutes` : "unknown"} · settles against its own opening price`,
    `Question: ${id.question ?? "n/a"}`,
    "",
    `COMPUTED VERDICT: ${a.verdict} (confidence ${a.confidence}: this measures how completely the market could be observed, NOT a probability of any outcome)`,
    `Action: ${a.action}`,
    "",
    "SIGNALS AS MEASURED:",
  ];

  for (const sig of a.signals) {
    // The label leads, and the id is marked as OURS rather than as vocabulary.
    // Sending `id=manipulation` beside a finding about order flow taught the model
    // to write "manipulation" in prose, where the interface says "Order flow" — the
    // reader then sees a word the product never uses, about a market nobody accused
    // of anything. Same mechanism behind `lastTradeAgeSec=103` appearing in a
    // sentence: whatever shape the prompt is in is the shape the prose comes back in.
    lines.push(
      `- ${sig.label} (severity: ${sig.severity}, our internal id for the signal_id field only: ${sig.id})`,
    );
    lines.push(`  finding: ${sig.finding}`);
    const ev = Object.entries(sig.evidence)
      .filter(([, v]) => v !== null && v !== undefined)
      // Long hex is dropped before the model ever sees it. Telling it not to quote
      // identifiers works better when the identifiers are not in the prompt: the
      // venue signal's evidence carries a 66-character venueId and its expected
      // twin, the depth signal carries an owner address, and one of them came back
      // inside a sentence. A reader cannot use them and the trace already shows them
      // verbatim in the evidence sheet, which is where they belong.
      .filter(([, v]) => !(typeof v === "string" && /^0x[0-9a-f]{16,}$/i.test(v)))
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    if (ev) lines.push(`  measured values, for reference, NEVER to be quoted as key=value: ${ev}`);
    // Threshold basis only where a threshold actually fired. On an `ok` signal
    // the finding already says "in line with this venue" and the calibration
    // detail is dead weight — eight bases cost ~430 input tokens against an
    // 8,000/minute free-tier ceiling, which is the difference between two and
    // three markets getting a model explanation. The guard's `allowedNumbers`
    // still admits every figure in every basis, so trimming the prompt cannot
    // turn a legitimate citation into a fabricated-number rejection.
    if (sig.severity !== "ok") lines.push(`  threshold basis: ${sig.basis}`);
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
      // Store the magnitude, not the signed value. The prose scanner matches
      // bare digits, so a netChange of -0.414 rendered as "41.4 points" would
      // otherwise look fabricated — a live run was rejected for exactly that.
      // The sign is direction, not a different measurement.
      const m = Math.abs(v);
      for (const s of [
        String(v),
        String(m),
        m.toFixed(0),
        m.toFixed(1),
        m.toFixed(2),
        m.toFixed(3),
        // Points and percentages are the same measurement, differently scaled.
        (m * 100).toFixed(0),
        (m * 100).toFixed(1),
        (m * 100).toFixed(2),
        // Seconds are routinely restated in minutes, hours and DAYS. Days were
        // missing until the resolution signal began reporting a four-day lapse:
        // the model restating 379487s as "4.4 days" would have been rejected for
        // a figure the finding itself handed it. That is the fourth time this
        // guard, rather than the model, was the thing that was wrong.
        Math.round(m / 60).toString(),
        (m / 60).toFixed(1),
        Math.round(m / 3600).toString(),
        (m / 3600).toFixed(1),
        Math.round(m / 86400).toString(),
        (m / 86400).toFixed(1),
        (m / 86400).toFixed(2),
        Math.round(m).toString(),
      ]) {
        out.add(s);
      }
    } else if (typeof v === "string" && /^\d+$/.test(v)) out.add(v);
  };
  add(a.confidence);
  // Numbers appearing in any text we handed the model are legitimate for it to
  // quote back — and to RESCALE, since probability points and percentages are
  // the same measurement. `basis` carries real distribution figures
  // ("spreads measured 0.021-0.029 points"), and live runs were rejected twice:
  // once for citing those figures at all, once for citing them as "2.1" and
  // "2.9" points. Both times the guard was wrong, not the model.
  const fromText = (text: string) => {
    for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
      out.add(m[0]);
      add(Number(m[0]));
    }
  };
  for (const s of a.signals) {
    for (const v of Object.values(s.evidence)) add(v);
    fromText(`${s.finding} ${s.basis}`);
  }
  for (const r of a.rules) fromText(r.because);
  for (const c of a.requiredChecks) fromText(c);
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
  //
  //    Measured false-positive rate before the prompt was tightened: ~1 run in
  //    3 lost a market to a rescaled-but-real figure (2.6 points cited as
  //    "2.5", a 0.095 fraction cited as "9.5%"). The fix is on both sides — the
  //    system prompt now forbids unit conversion outright, and the allowed set
  //    below admits every rescaling of every input number. A guard that rejects
  //    honest prose is not a safety feature, it silently downgrades good output.
  const allowed = allowedNumbers(a);
  for (const m of prose.matchAll(/\d+\.\d+/g)) {
    if (!allowed.has(m[0])) {
      failures.push({ check: "fabricated-number", detail: `"${m[0]}" appears in no evidence field` });
    }
  }

  // 4. Machine syntax in prose. The output is a sentence a person reads, so a
  //    field name, a key=value pair or a long hex identifier is a defect in the
  //    same class as a fabricated number: not wrong, but not written for anyone.
  //
  //    Caught live rather than reasoned about. A rendered summary read:
  //    "listed on DreamDEX (venueId=0x679795a0...) and tied to oracle question
  //    49517, with recent activity (lastTradeAgeSec=103, ageVsWindow=0.114) and
  //    45% of the 15-minute window elapsed (windowElapsed=0.448, secToExpiry=497)".
  //    Every figure in it was honest and verbatim, which is exactly why no other
  //    guard fired. The prompt now forbids this shape; this check is what makes
  //    the prohibition enforceable instead of advisory, and it fails the market to
  //    the deterministic narrator rather than shipping a log line as an
  //    explanation.
  //
  //    Deliberately narrow so it cannot reject honest prose: it wants a
  //    camelCase-or-suffixed identifier immediately followed by `=`, or 12+ hex
  //    characters. Ordinary sentences do not contain either.
  for (const m of prose.matchAll(/\b([a-z][a-zA-Z]*(?:[A-Z][a-zA-Z]*)+|severity|evidence)\s*=/g)) {
    failures.push({
      check: "machine-syntax",
      detail: `prose contains the field reference "${m[0].trim()}"; readers have not seen our schema`,
    });
  }
  for (const m of prose.matchAll(/0x[0-9a-fA-F]{12,}/g)) {
    failures.push({
      check: "machine-syntax",
      detail: `prose quotes the identifier "${m[0].slice(0, 12)}…"; it tells a reader nothing`,
    });
  }

  // 5. Outcome prediction — the one thing the product must never do.
  if (/\b(will (likely )?(resolve|settle|close) (yes|no|above|below))\b/i.test(prose)) {
    failures.push({ check: "outcome-prediction", detail: "prose predicts the market's resolution" });
  }

  return failures;
}

// ── deterministic fallback ─────────────────────────────────────────────────────

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
    // NO per-signal readings. The narrator's template was
    // `${label} ${severityPhrase}. ${finding}` — which restated the engine's
    // finding verbatim on every signal, and on a live render made 8 of 8 readings
    // pure duplication. The UI already prints the finding; a reading exists to add
    // something to it, and the deterministic path has nothing to add by
    // construction. An empty list is the honest answer, and the same rule the
    // model is now given: say nothing rather than say it twice.
    perSignal: [],
    source: "fallback",
    fallbackReason: reason,
  };
}

// ── the model call ─────────────────────────────────────────────────────────────

export interface ExplainOptions {
  /** Override the resolved provider entirely (tests, explicit routing). */
  provider?: ProviderConfig;
  /** Skip the model entirely — used by tests and offline demos. */
  offline?: boolean;
  timeoutMs?: number;
}

/**
 * Explain an assessment. Never throws, never returns an empty explanation.
 *
 * The provider comes from `.env` (Groq by default) and the schema has no verdict
 * field, so no provider — however weak the model — can override the engine. That
 * property lives in the schema, which is why switching providers is safe.
 *
 * Every failure path lands on `fallbackExplanation` with the reason recorded: no
 * key configured, unreachable endpoint, malformed output, or a guard rejection.
 * The caller always gets prose, and the trace always says where it came from.
 */
export async function explainAssessment(
  s: MarketSnapshot,
  a: Assessment,
  opts: ExplainOptions = {},
): Promise<Explanation> {
  if (opts.offline) return fallbackExplanation(s, a, "offline mode requested");

  const cfg = opts.provider ?? resolveProvider();
  if (!cfg) {
    return fallbackExplanation(
      s,
      a,
      "no LLM provider configured (set GROQ_API_KEY in .env, or run with --offline)",
    );
  }

  try {
    const result = await callProvider(cfg, {
      system: SYSTEM,
      user: `${renderAssessment(s, a)}\n\nReturn your reading of these signals. Signal ids you may cite: ${a.signals.map((x) => x.id).join(", ")}.`,
      schema: EXPLAIN_TOOL_SCHEMA,
      schemaName: "emit_explanation",
      schemaDescription:
        "Emit the plain-language explanation of this assessment. This is the only way to respond.",
      maxTokens: 2_048,
      timeoutMs: opts.timeoutMs,
    });

    const raw = result.output as {
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
      model: `${cfg.kind}:${result.model}`,
      usage: result.usage,
    };
  } catch (e) {
    const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    // Label the provider so a failure is diagnosable without leaking the key.
    return fallbackExplanation(s, a, `${describeProvider(cfg)}: ${reason}`);
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
  /**
   * Closes that actually printed, oldest first. Sparse by nature: buckets are emitted
   * per trade, so a gap in `t` means no trade occurred, never a missing reading.
   * Consumers must not interpolate across one.
   */
  prices: { t: number; close: number; volume: number }[];
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
    /**
     * The price series, thinned but never interpolated.
     *
     * Carried so the UI can plot what actually printed. Two rules travel with it and
     * both are load-bearing:
     *
     * 1. GAPS ARE REAL AND MUST SURVIVE. Candle buckets here are emitted per trade,
     *    not per interval, so a market that did not trade for two hours has no points
     *    for two hours. Measured on BTC 24h: 51 points over 15.4h with a 150-minute
     *    hole, 16% of the whole span. Anything that draws a line across that hole is
     *    inventing prices, which is the one thing this product exists not to do.
     * 2. FEWER THAN `MIN_SAMPLES_FOR_MOVE` POINTS IS NOT A CHART. `moveMetrics`
     *    already refuses to compute a move below three samples and reports
     *    `insufficient` instead of a confident zero. The UI has to make the same
     *    call, so the series is passed through as-is and the renderer decides.
     *
     * Capped at 200 points, which is the query limit anyway, so a long-running market
     * cannot bloat the payload the API route serves.
     */
    prices: (s.prices.value ?? []).slice(-200).map((p) => ({
      t: p.t,
      close: Number(p.close.toFixed(3)),
      volume: Number(p.volume.toFixed(2)),
    })),
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
