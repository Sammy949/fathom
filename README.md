# Fathom

Due diligence for [DreamDEX](https://docs.dreamdex.io) Event Contracts on Somnia. Fathom reads
a prediction market's order book, chain state and oracle binding, and grades it
ALLOW / RECHECK / BLOCK with a decision trace you can open and check line by line.

Live: [fathom.samuelyahaya.com](https://fathom.samuelyahaya.com) ·
Agent surface: [`/api/markets`](https://fathom.samuelyahaya.com/api/markets)

It is not a dashboard and not a trading bot. It is a judgment layer: the agent is the engine,
the dashboard is how a person reads it.

## The model cannot change the verdict

Deterministic code computes eight signals from measured venue data and maps them to a verdict.
The LLM is then handed those findings and asked for prose, through a JSON schema carrying no
verdict, no confidence and no numeric field. There is no field it could write a verdict into,
so the question of what happens when the model disagrees with the engine cannot arise. That is
deliberately stronger than asking a model for a verdict and checking it afterwards, which
leaves a disagreement someone has to adjudicate.

Four guards sit on the prose, because plausible-sounding wrong text is the most damaging thing
this can emit. Every claim must cite a signal id that exists in the assessment. Verdict words
contradicting the computed verdict are rejected, so "safe to trade" under a BLOCK fails even
though the verdict field is untouched. Numbers in the prose are checked against the evidence,
which catches fabrication. Outcome predictions are rejected outright, and so is an unmeasured
signal described as healthy, because `unknown` must never read as reassuring.

Any failure at all (no key, unreachable endpoint, malformed output, a guard rejection) lands on
a deterministic narrator built from the same signals, with the reason recorded in the trace. It
degrades to plainer language, never to a wrong verdict and never to a blank panel.

## The signals

Eight, computed in code. Each carries a `basis` string naming the measured distribution that
justifies its cut points; see `THRESHOLDS` in `packages/core/src/risk.ts`, where the comment is
the justification rather than decoration.

| Signal | Reads |
|---|---|
| `venue` | Whether the market sits on the real venue or the zero-volume pricefeed-test one |
| `resolution` | Oracle question binding, `supersededByQuestionId`, void policy, settlement-window lapse |
| `liquidity` | Absolute spread in probability points, executable size, crossed or one-sided books |
| `depth` | Phantom depth (orders past expiry, still displayed, skipped by the matcher) and quote TTL |
| `volatility` | Probability move across the price history, `insufficient` below 3 samples |
| `staleness` | Time since the last fill, relative to the market's own window |
| `window` | Time to expiry against the lock boundary, since a market can lock between snapshot and send |
| `manipulation` | Taker flow skew, corroborated by resting depth imbalance |

In evaluation order: a severe `venue` or `resolution` signal blocks under its own rule name;
any other severe signal blocks; an unreadable book is RECHECK, because unobservable liquidity
is not acceptable liquidity; and any unmeasured signal at all withholds ALLOW, since ALLOW
means `may_execute` and should mean everything was actually looked at.

Two findings constrain anything added here later. First, a metric that is constant across the
venue is a caption and never a severity input: depth imbalance reads exactly 0.000 on every
quoted market because the maker ladder is symmetric by construction, and owner concentration
reads 1.00 because there is one maker address per market. Both are reported; neither moves a
verdict. Second, depth and spread never come from indexer `Order` rows. Those rows showed bids
at 0.496 alongside asks at 0.082, all `status: Open`. A book cannot be crossed by 40 points, so
the rows are stale, and everything comes from the materialized book or a per-order chain read
instead.

## Layout

```
packages/ec/      5 vendored ec-core modules, read path only (see VENDORED.md)
packages/core/    the engine
  indexer.ts      retry-wrapped GraphQL
  resilient.ts    retry-wrapped SDK calls
  queries.ts      market / candle / fill / oracle queries, marketId-scoped
  chain.ts        per-order on-chain reads
  book.ts         spread, depth, near-touch imbalance, executable size
  depth.ts        owner classification, phantom depth, quote TTL
  history.ts      price points, move, flow, freshness
  snapshot.ts     MarketSnapshot + provenance
  ingest.ts       assembles it all
  risk.ts         the eight signals and the verdict state machine
  explain.ts      the schema with no verdict field, the four guards, the fallback narrator
  provider.ts     one OpenAI-compatible adapter, Groq by default
apps/web/         Next.js 16 dashboard, and the agent's JSON surface
scripts/          the gates
fixtures/         frozen evidence: one stuck market, one whole board
notes/            product spec, verified integration surface, deploy guide, handoff log
```

Everything downstream of `packages/core` reads `MarketSnapshot` and nothing else. Nothing past
that package touches the indexer, the SDK or the chain directly.

A read is never quietly a zero. `Sourced` fields carry provenance, `degradedFields` lists what
could not be read, and a signal that could not be measured reports `unknown` rather than a
confident number.

## Running it

```bash
bun install                 # from the repo root; one lockfile covers all four workspaces
cp .env.example .env        # every value is optional to start
```

`.env` is gitignored and nothing in it belongs in a tracked file. The whole read path runs
without a private key, and the explanation layer runs with no LLM key at all through
`npm run explain -- --offline`.

The dashboard, from the frozen board, with no network in the render path:

```bash
cd apps/web && npm run dev  # sets FATHOM_FIXTURE=1
```

`npm run dev:live` hits the live venue instead. Start the dev server yourself rather than from
an agent tool call: stacked Turbopack worker pools have crashed this WSL box twice.

There are two surfaces and they share one read. `/` is the board and `/m/[id]` is a single
market's evidence and trace; `GET /api/markets` and `GET /api/markets/[id]` return the same
in-memory read those pages render, so an agent polling JSON and a person reading the page
cannot come away with different verdicts. The response declares `capability: "read-only"`, and
the venue client is opened without a signer.

### Fixture mode

`npm run capture:board` freezes one live pass to `fixtures/board.json`, and `FATHOM_FIXTURE=1`
renders from that file. Live remains the default, so a deploy behaves as it always did.

This is demo insurance rather than a dev-loop speedup. The board moves with venue state: three
grade runs inside two hours gave 0 ALLOW / 10 RECHECK / 0 BLOCK, then 0 / 4 / 6, then 0 / 9 / 1,
and all three were correct. Someone who reloads mid-demo gets a different screen than the one
being shown. The committed board is a single pass with all three verdicts on it, which is the
one artifact that demonstrates the engine discriminating.

Two details worth not rediscovering. The capture imports the dashboard's own `buildVenueRead`
rather than reassembling rows, so the fixture cannot drift from what the page renders. And it
refuses to run with `FATHOM_FIXTURE` already set, since that would capture the file it is
reading.

A GitHub Action recaptures the board hourly and commits only when it changed. Measured, it
fired on 1 of 7 slots, so treat it as a backstop and read the tally the capture prints before
trusting a frozen board for a demo.

## Commands

| Command | What it does |
|---|---|
| `npm run snapshot` | Stage 2 gate: ingest and provenance, lists every live venue |
| `npm run capture -- <marketId> [label]` | Freeze one market's whole evidence set to `fixtures/` |
| `npm run capture:board` | Freeze the whole board to `fixtures/board.json` |
| `npm run calibrate` | Threshold sweep: per-market rows and distributions |
| `npm run probe:book` | Book-read stability, polling once a second for 90 seconds |
| `npm run grade` | Stage 4 gate: verdicts, traces, discrimination check |
| `npm run explain` | Stage 5 gate: full traces, verdict integrity, guard proof |
| `npm run explain -- --offline` | The same, deterministic narrator only, no key needed |
| `npm run test:risk` | 89 assertions over synthetic snapshots and the frozen fixture, no network |
| `npm run retry:test` | Proves retry distinguishes transient from terminal |
| `npm run typecheck` | The whole workspace, `scripts/` included |
| `cd apps/web && npm run check:expiry` | A past-expiry row cannot render unflagged at any width |

The gates are adversarial on purpose, and each has been made to fail deliberately. The
recurring bug here was never a broken feature; it was a gate whose happy path never ran.
`explain` once reported PASS with 0 of 3 markets model-explained, and `grade` once reported
PASS having graded zero markets. Both now fail rather than report a check that did not run.

## Configuration

[`.env.example`](.env.example) documents every variable with blank values. `VENUE_ID` is
required, and venue ids move (three times in one week), so `npm run snapshot` prints every live
venue and marks the configured one.

Groq is the default LLM provider: free tier, no card, fast enough for a live demo. One
OpenAI-compatible adapter covers OpenRouter, Together, Cerebras, DeepSeek and Ollama, so
`LLM_BASE_URL` is the only thing that changes between them. Anthropic is an explicit opt-in and
never a silent fallback. Whatever model you point it at must support strict structured outputs,
or the schema stops being enforced and the guards carry weight they were not designed to carry
alone.

`PRIVATE_KEY` and `DRY_RUN` matter only for gated testnet execution, which is Stage 6 and not
built. Use a wallet holding nothing on any mainnet.

`ANALYTICS_SCRIPT_URL` and `ANALYTICS_WEBSITE_ID` add a self-hosted Umami beacon to the
dashboard. Both describe private infrastructure, so they are blank in the template and set
only in `apps/web/.env.local` and the Vercel project. Leave them blank and
`apps/web/components/analytics.tsx` renders nothing — no third-party script, no behaviour
change. It is gated to production builds, so `npm run dev` never reports.

## Deploying

Full walkthrough in [`notes/deploy.md`](notes/deploy.md). Deploy in fixture mode
(`FATHOM_FIXTURE=1`, one variable, no keys): a live pass is roughly 150 round trips that cannot
finish inside a serverless function's budget, the stale-while-revalidate cache does not survive
between invocations, and on 2026-09-05 the indexer's Postgres went down for hours while its
GraphQL gateway stayed up and answered schema queries. Set Root Directory to `apps/web` with
*Include files outside Root Directory* on, or the workspace packages and the fixture never
reach the build context.

## Reading further

- [`notes/product-fathom.md`](notes/product-fathom.md) is the product spec: risk-signal
  definitions, the calibration warning, and the design bar.
- [`notes/dreamdex-surface.md`](notes/dreamdex-surface.md) is the integration surface, verified
  against the live docs, the repo, npm and live indexer queries. Read it before writing client
  code. Event Contracts have no REST API and no auth flow, and the original brief was wrong in
  three places.
- [`notes/handoff.md`](notes/handoff.md) is the running log of what was measured, what broke,
  and why each decision went the way it did.
- [`packages/ec/VENDORED.md`](packages/ec/VENDORED.md) records what was copied from the Bot Kit
  and what was deliberately left behind.

## Attribution

`packages/ec/` is vendored from
[`somnia-chain/dreamdex-bot-kit`](https://github.com/somnia-chain/dreamdex-bot-kit)
(`packages/ec-core/src/`) at upstream commit `dccd2fd`, MIT licensed. Copyright (c) 2026
DreamDEX S.A. See [`packages/ec/LICENSE.dreamdex`](packages/ec/LICENSE.dreamdex).
