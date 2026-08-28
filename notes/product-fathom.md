# Fathom — Product Spec

## What it is (one line)
An explainable risk-and-execution copilot for DreamDEX Event Contracts that turns live CLOB
data into auditable **ALLOW / RECHECK / BLOCK** decisions, with optional testnet execution.

## Why "Fathom"
Two meanings that both land: a *fathom* is a unit of depth (order-book depth is exactly what
we measure), and to *fathom* is to understand (what the agent does). Nautical sibling to
**Anchor** (the Aave-reading risk agent that this reuses the verdict pattern from), without
being cute about it.

## The core insight (don't lose this)
It's **not** a dashboard and **not** a trading bot. It's a **judgment layer over a
prediction market** — due diligence for Event Contracts. Architected **agent-first,
dashboard-presented**: the dashboard is the interface; the agent is the reason it deserves
to exist. Build the decision loop first, then the UI around it.

**Critical design choice:** the model does NOT invent the risk score and does NOT predict
YES/NO outcomes. Deterministic code computes the facts; the LLM *interprets* them into a
verdict + explanation. This is defensible; "ask an LLM if the market resolves YES" is not.

## Risk signals (deterministic, computed in code)
| Signal | Interpretation |
|---|---|
| Liquidity risk | Wide spread or insufficient depth to enter/exit reliably |
| Volatility risk | Sudden probability move without matching depth/volume |
| Staleness risk | Market data hasn't updated recently enough to trust |
| Resolution risk | Ambiguous wording, uncertain resolver, unclear settlement |
| Manipulation signal | Extreme order-book imbalance, abrupt move, thin-side activity |

(Add Event-Contract-specific fields once settlement/resolution mechanics are confirmed from docs.)

## Verdict schema (strict output the LLM must return)
```json
{
  "verdict": "RECHECK",
  "confidence": 0.74,
  "reasons": [
    "Implied probability moved 11.8 points in 20 minutes.",
    "Ask side has only 1.6x the minimum executable depth.",
    "Resolution wording requires confirmation before execution."
  ],
  "required_checks": ["Confirm settlement source", "Wait for two more order-book updates"],
  "action": "do_not_execute"
}
```
- **ALLOW** — passes liquidity, pricing, resolution-risk checks.
- **RECHECK** — interesting but needs more data/confirmation.
- **BLOCK** — too illiquid, manipulated, stale, or ambiguous to trade.

## Implementation sequence
| Stage | Deliverable | Required? |
|---|---|---|
| 1 | Clone Bot Kit, run doctor script, find live Event Contract markets, confirm auth on Shannon | Yes |
| 2 | REST + WebSocket ingestion → normalized market + order-book state | Yes |
| 3 | Dashboard: market list, detail view, probability chart, liquidity metrics, freshness | Yes |
| 4 | Deterministic risk metrics + ALLOW/RECHECK/BLOCK state machine | Yes |
| 5 | Structured agent reasoning + inspectable decision trace | Yes |
| 6 | Gated `placeOrder` testnet execution + order-status panel | Strongly recommended |
| 7 | Polish, failure states, demo-data fallback, technical walkthrough | Yes |

**Cut line = after Stage 5.** If time gets tight, Stages 1–5 are still a credible agentic
analytics product. Stage 6 is the high-value stretch that shows the full execution surface.

## Human-approved execution flow (the demo)
1. Agent identifies a market → 2. shows evidence + verdict → 3. user opens decision trace →
4. user approves a small testnet order → 5. product places it via DreamDEX, reports result.
Keep `DRY_RUN=true` default; expose a visible "testnet execution" mode for the live demo.

## Demo narrative
Open on a live Event Contract whose probability moved sharply. Dashboard shows the move, thin
liquidity, order-book imbalance. Agent marks it **RECHECK**, not a blind trade. Open the
decision trace → verdict came from structured data + resolution-risk checks → wait for
confirmation or execute a small approved testnet order. Communicates three things at once:
we understand prediction markets, we used DreamDEX's real market-data + execution surfaces,
the agent adds a real safety/decision layer.

## What NOT to build before the deadline
No full autonomous portfolio manager, multi-market arbitrage, custom backtesting framework,
social sentiment pipeline, or production unattended execution. Don't support every Event
Contract type — pick a small representative set and make the monitor→reason→execute loop
excellent.

## Design bar
Anti-slop law applies (see global CLAUDE.md). Dashboard is the visual centerpiece and scores
UX/Design 20% — decide a real signature, not a generic market-data wrapper.
