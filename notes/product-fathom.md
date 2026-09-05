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
| Resolution risk | Oracle binding, void policy, settlement-window lapse (see below) |
| Manipulation signal | Extreme order-book imbalance, abrupt move, thin-side activity |
| **Window risk** | Time to expiry against the lock boundary — a short window can lock between snapshot and send |
| **Venue risk** | Market sits on the pricefeed-test venue rather than the real one |

### Resolution risk, corrected

The original framing was **ambiguous wording**. That does not survive contact with the venue:
every live market asks the same templated question (`"BTC closes at or above its opening
price"`, `strike: 0`), and the docs explicitly say **do not parse the question text** — its
wording has been revised repeatedly while the typed `asset` / `intervalSec` fields stayed
stable. Grading wording would be grading a constant.

What actually varies per market, and what the signal should read instead:
- **Oracle question binding** — `oracleQuestionId`, and `supersededByQuestionId` on
  `OracleQuestion` (a superseded question is a real red flag).
- **Void policy and void risk** — `voidPolicy` on the market row; a market voids to 0.5/0.5
  when no dependable settlement price lands inside the settlement window.
- **Settlement-window lapse** — nothing posted after expiry means anyone can call
  `voidExpired()`. Time past expiry with no answer is a measurable, escalating signal.
- **Multi-source agreement** — the oracle publishes every source, its value, the median, and
  how many sources had to agree. Thin agreement is resolution risk with a receipt.

Because resolution is **auditable per market**, the decision trace should link
`https://prd.oracle.somnia.host/questions/{oracleQuestionId}?view=graph`. That link is the
strongest single credibility move available to us: the verdict cites a source a judge can open.

### Calibration warning

Wide spreads are the **normal state** on this venue — BTC 15m sat 0.536/0.607, a 7-point
spread on a 0.57 mid, with a three-level ladder each side at ~200/330/460 shares. Thresholds
calibrated against a real-money book will grade every market BLOCK and the verdict will say
nothing. Calibrate against observed testnet distributions, and say so in the trace.

### The constant-metric rule (stated once, so it stops being rediscovered)

**A metric that is constant across every market on the venue is a caption, never a severity
input.** It cannot discriminate, and a signal that fires on everything communicates nothing.
Report it, because it is often the most interesting fact on screen. Do not let it move a verdict.

Two signals are constant for STRUCTURAL reasons, and those are the real cases:

| Metric | Measured | Why it is constant |
|---|---|---|
| Depth imbalance | exactly `0.000` on every quoted market | the maker ladder is symmetric by construction; it only moves once a side is partly consumed |
| Owner concentration | `1.00` on all 10 markets, twice | one dedicated maker address per market |

**And one that looked constant and is not, which is the sharper lesson.** Near-touch depth measured
990 shares on all 10 markets, and on all 270 reads of a 90-second poll across three of them — so it
looked like a third instance of the rule, and `depthElevated: 200` / `depthSevere: 50` looked
unreachable. It is not. The three polled markets had **never traded**, so their ladders were
pristine; 990 is the size of an UNCONSUMED ladder, not a venue constant. A later run graded one
market `elevated` at exactly 200 shares near the touch, and another `severe` on a one-sided book
where the maker had pulled its asks two minutes from expiry. Near-touch depth discriminates
precisely when there has been activity.

So the test to apply before wiring any new signal to severity is two-part, and the second half is
the one that was nearly missed:

1. **Measure the range across the whole board.** `npm run calibrate` prints this under
   "discriminating power" and `npm run grade` flags any signal that came back constant. Zero range
   means it belongs in the trace as a stated fact with its own sentence, not in the severity ladder.
2. **Ask whether the board was in one state when you measured it.** An idle board makes
   activity-driven metrics look constant. A metric flat across ten never-traded markets has been
   measured once, not ten times. Check it again when something has traded before concluding it
   cannot discriminate.

### Data-source constraint (non-negotiable)

Depth, spread and imbalance come from the SDK's materialized book (`fetchOrderBook`) or an
on-chain read — **never** from indexer `Order` rows. Verified live: those rows show bids at
0.496 alongside asks at 0.082, all `status: Open`, `filledQuantity: 0`. A book cannot be
crossed by 40 points; the rows are stale. This is the most likely way the risk engine ships
confidently wrong numbers.

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
| Stage | Deliverable | Required? | State |
|---|---|---|---|
| 1 | Clone Bot Kit, run `ec:doctor`, confirm venue + live markets on Shannon | Yes | done |
| 2 | Indexer + on-chain ingestion → normalized market + order-book state | Yes | done |
| 3 | Dashboard: market list, detail view, probability chart, liquidity metrics, freshness | Yes | built, unseen in a browser |
| 4 | Deterministic risk metrics + ALLOW/RECHECK/BLOCK state machine | Yes | done |
| 5 | Structured agent reasoning + inspectable decision trace | Yes | done |
| 6 | Gated testnet execution (`ec-core` `placeLimit`) + order-status panel | Stretch | not started |
| 7 | Polish, failure states, demo-data fallback, technical walkthrough | Yes | failure states + fixture fallback done |

**Cut line = after Stage 5, and it is cleared.** Stages 1–5 are complete; Stage 3's dashboard is
built and Stage 7's failure states (loading, error, 404) and demo-data fallback
(`FATHOM_FIXTURE=1`) are in. The largest remaining risk is not a missing stage — it is that the
dashboard has never been opened in a browser. Every check has been server-rendered markup or
static SVG, so nothing interactive is verified.

Stage 1 gate is `npm run ec:doctor` against Shannon — read-only, sends nothing. Note there is
no auth step to confirm (private key only, no REST/SIWE for event contracts), so the gate is:
correct venue resolved, live markets listed, on-chain status readable, book snapshot returned.

### What the dashboard settled, and the rule each decision produced

Stage 3 was specified above as "market list, detail view, probability chart, liquidity metrics,
freshness". All five exist, but three of them ended up somewhere other than where that line
implies, and the reasons generalise:

- **The probability chart is a STEP, not a line.** Candles here are emitted per trade, not per
  interval, so the series is irregular by nature — 3 to 6 points spanning hours, with holes. A
  smooth line between two prints invents drift that never happened; a flat hold is what a
  last-traded price actually claims. Two earlier attempts (runs-with-gaps, then a median-gap
  threshold) both drew confident diagonals through real holes, and **only a render caught it**.
  The rule: when samples are not periodic, do not interpolate, and prove it by rendering rather
  than by reading the code.
- **The chart's right edge is the READ TIME, not the last print.** If horizontal width means
  elapsed time then the age of the newest reading is width that exists. Measured: a last print
  170 minutes old, 29% of the chart. Ending at the last print silently claims it was now.
- **"Liquidity metrics" became `quote life` and `owners`.** The generic spread/depth pair is
  available in every venue interface. Median seconds-to-expiry of the resting book and the number
  of addresses owning it are not: `owner` and `expireTimestampNs` are per-order on the chain read
  and every aggregated view sums them away. A book reading "990 shares a side" everywhere else is
  one address on a 20-second timer. That is the column no competitor screen can show.
- **The eight-signal "sounding" mark was cut from the board.** Graded across the live venue, its
  first four marks read `ok` on every row — half of every glyph carrying no information — and it
  encoded severity as shape AND depth AND confidence as length across eight unlabelled positions
  with no legend. The rule it produced: **a visual encoding needs a key on the same screen, or it
  is decoration**; and the constant-metric rule above applies to marks, not just to severity
  inputs.
- **The board is a real `<table>`.** It was two CSS grids agreeing by convention and they had
  already drifted apart. One `<colgroup>` with `table-layout: fixed` is a column the layout engine
  guarantees, and fixed widths stop a counting-down value from resizing its column on refresh.


## Demo market selection (from live testnet data, 2026-08-28)

Venue: `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c` (operatorId 2).
The other active venue (`0x1a1e6821…`, operatorId 4) runs 60s/300s pricefeed-test markets with
zero volume — **not** demo candidates.

Target the three longest windows on the real venue:
- **BTC 86400s (24h)** — deepest book, 16 trades. Survives a whole demo session.
- **BTC 14400s (4h)** — 11 trades, 10 bids vs 3 asks. Visible imbalance, good RECHECK candidate.
- **ETH 86400s (24h)** — 10 trades, both-sided book. Second asset for contrast.

Avoid 60s/300s outright (expire before a judge finishes reading) and treat 900s as a fallback.

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

**The signature that was chosen: the page is an audit document, not a trading terminal.** Rows on
a shared baseline with hairline rules, every figure in a self-hosted mono with tabular numerals,
verdicts set in a display serif whose numerals are near-monospaced, and colour reserved for the
one thing that is a decision. Three faces, three jobs: Instrument Sans for interface, Zodiak for
verdicts and headline figures, Geist Mono for every measured number. Instrument Serif italic as a
sparing counter-voice. All four self-hosted from `public/fonts`, because `next/font/google`
fetches at build time and this network's IPv6 path is dead — a build that needs a third-party host
is a build that fails on someone else's network.

Three rules the build produced, worth keeping:

- **Colour states a decision; ink states a reading.** The traffic light stops at `VerdictMark`.
  A signal severity gets an ink ramp instead, because green on a reading would claim "fine" about
  a measurement that may never have been taken. Weight carries rank independently of hue, so the
  row scans in greyscale.
- **An unmeasured reading must look unmeasured** — not clean, and not like a rendering gap. This
  is the same invariant as the engine reporting `insufficient` rather than a confident zero, and
  it is why the no-reading mark is a middle dot rather than a blank or an em-dash.
- **Render it before believing it.** Two chart bugs and a table's worth of misalignment were
  invisible in code and obvious in a render. The pattern that works: render the real component
  (never a re-implementation), substitute theme `var(--…)` for hex, and assert geometry against
  the input data.

