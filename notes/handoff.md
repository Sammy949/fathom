# Fathom — Handoff Log

Running log of state + decisions + next actions. Newest at top.

## 2026-09-02 (later) — the gates could pass with the real path at zero

The audit started from a rule rather than a symptom: **does this gate's happy path get
exercised on every run, or can a fallback stand in for it while the gate still says PASS?**
Two gates failed that question and both failures were reproduced on demand, not reasoned about.

1. **`npm run explain` reported PASS with 0 of 3 markets model-explained.** Nothing in it read
   `explanation.source`. Shown twice: `-- --offline` printed "PASS — model explains, engine
   decides" over three narrator fallbacks, and an invalid key printed the same PASS while every
   call returned 401. This is the gate that missed the `signal_id` enum drift, and it would have
   missed it again. It now requires every chosen market back as `source === "model"` whenever a
   provider is configured and offline was not requested, names the `fallbackReason` on failure,
   and no longer claims "model explains" after a narrator-only run. Verified red on the invalid
   key (exit 1, reason quoted), green on the live path (3 of 3), "not asserted" offline.

2. **`npm run grade` reported PASS having graded zero markets.** Pointing `VENUE_ID` at an id
   carrying no live markets passed determinism, discrimination and the severity→verdict mapping,
   with `confidence min Infinity max -Infinity` as the only visible tell. Every assertion loop was
   vacuous, the discrimination check skipped itself behind `graded.length >= 3`, and per-market
   ingest failures were printed in red and then dropped. Now an empty board fails, any ingest
   failure fails, checks that did not run print "not asserted" rather than PASS, and a new
   **reads** section fails when a field is degraded on *every* market. That last one is the hole
   the depth signal could have fallen through: the per-order chain read going dark would have
   printed `depth constant (unknown)` and kept the gate green.

3. **The mapping line printed PASS unconditionally**, outside the loop that collects the
   violations, so a real break printed PASS and then FAIL below it. It also carried a latent false
   positive: `not-trading` and `no-onchain-state` force a verdict *before* the severity mapping is
   consulted, so a Locked market whose signals all read ok would have been reported as a mapping
   violation. Those two are now asserted on their own terms.

4. **The frozen fixture was written by one script and read by none.** `capture.ts` records
   `verdictAtCapture` "so a regression shows up as a diff rather than a silent change", and nothing
   ever compared it, which made the strongest BLOCK in the demo the only case with no gate behind
   it. `test:risk` now grades the frozen snapshot and asserts verdict, confidence, action, rule
   order and every severity against the recording, plus the case's own invariants. Grading it is
   deterministic because every clock-dependent number was resolved at capture. A missing fixture
   FAILS rather than skips. Proven red both ways: flipping `tradable` to true caught the lost
   `not-trading` rule, hiding the file failed the gate.

5. **The product broke its own core invariant in one line.** `ingest.ts` wrapped freshness in
   `ok()` unconditionally while `freshness()` derived `neverTraded` from an absent timestamp, so a
   failed fills read on a row with no indexed `lastTradeAt` published "this market has never
   traded, so its quoted mid reflects a maker's opening guess" **as a measurement**, with
   provenance clean enough that `degradedFields` did not list it. A claim about the market
   manufactured from an outage, in the one layer whose entire purpose is that a degraded read is
   not a zero. There is now a `recencyUnknown` flag, mutually exclusive with `neverTraded`, and
   staleness reports unknown. Freshness as a whole stays `ok` on purpose: expiry and window elapsed
   are still genuinely measured, and degrading the field wholesale would blind the window signal
   over a fills query, turning one honest gap into two.

**AND THE NEW ASSERTION IMMEDIATELY EARNED ITS KEEP.** Running `npm run explain` four times with
the source check in place: **2 of the 4 runs lost a market to the fallback**, for two different
reasons, and every one of those runs would have printed PASS yesterday.

- once `TypeError: fetch failed` — the documented WSL transport flake, which the provider already
  retries; three attempts were exhausted.
- once `HTTP 400 code: "json_validate_failed"` — **Groq rejecting its own constrained generation**,
  "missing properties: 'summary'". Strict mode is supposed to make that impossible. The cause is the
  token ceiling: successful runs bill 1,171 / 1,176 / **1,396** output tokens against
  `max_completion_tokens: 1400`, so the longest explanations sit ON the cap and the next one over it
  is cut off mid-object, producing JSON that fails its own schema.

That 400 is transient in exactly the way a 429 is — the next generation is usually a little shorter —
so it is now retried, while every other 400 still fails fast because a real schema rejection will
never fix itself. The classification is exported as `isRetryableGenerationFailure` and asserted in
`retry:test`, for the same reason the 429 parser is: a retry rule that is not asserted is a guess,
and this one decides whether a market reaches the model or the narrator. Raising the ceiling instead
would have spent the increase on every call, since Groq bills it as requested rather than as used.

After the fix: **5 consecutive runs, 15 of 15 markets model-explained.** Before it, 2 of 4 runs
degraded silently under a green gate.

**AND THE PROBE, RE-RUN AN HOUR LATER, SETTLED IT FROM THE OTHER SIDE.** `npm run
probe:book` on a board that had since traded: the two idle 24h markets still read 990
on all 90 reads each, and the third, a 4h market past its last fill, read **one-sided
on 90 of 90 reads** — `levels 0/3`, no bid at all, for the entire 90 seconds. So the
severe conditions this venue actually produces PERSIST: the maker withdraws a side and
leaves it withdrawn. A two-poll rule would not have softened that verdict, it would
have confirmed it. The false-BLOCK-from-one-unlucky-read failure mode is not the one
this venue has.

**THE REPOST-TIMING GAP DOES NOT EXIST ON THIS VENUE, MEASURED.** The worry was that a single
`fetchOrderBook` could land between a maker cancel and its repost, read an empty or thin book, and
grade liquidity severe — which is BLOCK — on a market that is fine. Polled three markets once a
second for 90 seconds: **270 reads, 90 of 90 distinct book timestamps per market** (so every read
was fresh and nothing was served from a cache), and `min(bid.nearShares, ask.nearShares)` came back
**exactly 990 on every single read**. Min equals max. No empty read, no one-sided read, nothing
under either depth threshold. The proposed fix — hold the thin-book condition across two
consecutive polls — would have been 60-80 lines across four files, a second book read plus a dwell
on every pass, and a decision about a frozen fixture that has only one read, all to defend a
condition that does not occur. Not built.

**What replaced it costs nothing and is a better line in the room.** The snapshot already carries
two independent observations of resting liquidity: the materialized book, and the per-order chain
read taken seconds later in the same pass. When the book reads empty or one-sided while the chain
shows live orders on both sides, the two sources contradict each other and the aggregated book is
the one that is wrong. `liquiditySignal` now reports that as `unknown` rather than `severe`, on
exactly the precedent already set by the crossed-book branch ("the data is untrustworthy, not the
market"), which makes the verdict RECHECK with "re-read the order book and confirm both sides are
quoted" attached. Narrow on purpose: it needs shares on both sides plus live shares overall, it
never fires from a missing or degraded chain read, and it does not touch near-touch thinness
because `DepthMetrics` carries no price levels.

Two existing fixtures had to be corrected to make it pass, and the correction is the finding: they
paired an empty or one-sided book with a full 6-order chain ladder, which is not a state this venue
can be in. It is the contradiction, and it was sitting in the test suite as the definition of BLOCK.

**The constant-metric rule is now written down** in [product-fathom.md](product-fathom.md) rather
than being rediscovered per signal — and it arrived with its own counter-example, which is the more
useful half. Near-touch depth measured 990 on all 10 markets and all 270 polled reads, so it looked
like a third instance of "constant, therefore a caption", and `depthElevated: 200` looked
unreachable. Wrong: the three polled markets had **never traded**, so 990 is the size of an
unconsumed ladder rather than a venue constant. A later run graded one market `elevated` at exactly
200 shares near the touch. **A metric flat across ten idle markets has been measured once, not ten
times.** Imbalance at 0.000 and owner concentration at 1.00 still stand, because those are
structural.

**The demo board swings with venue state, and that is the real credibility risk** — not a timing
artifact. Three `grade` runs inside two hours: `0 ALLOW / 10 RECHECK / 0 BLOCK`, then `0 / 4 / 6`,
then `0 / 9 / 1`. All three are correct. The single BLOCK in the last run is worth reading, because
it is the case the two-poll fix was meant to protect against and it turns out to be real: a 15m
market at 88% of its window with **no ask quoted**, and the per-order chain read agreeing at 990
shares across 3 orders on one side only. Two independent sources concur that the maker pulled one
side two minutes from expiry, so the cross-source check correctly did NOT downgrade it. That is a
defensible BLOCK to be asked about. The frozen fixture exists to have one stable BLOCK whatever the
board is doing, which is why wiring it into a gate mattered more than the two-poll change.

Verified: `npm run typecheck`, `npm run test:risk` (**89 assertions**, was 65), `npm run grade`,
`npm run explain`, `npm run explain -- --offline`, plus the four deliberate-failure runs above.

## 2026-09-02 — depth durability, the stuck-market fixture, and the ink-depth restyle

Eight commits. `npm run typecheck` (now covers `scripts/` too), `npm run test:risk`
(65 assertions, was 42), `npm run retry:test`, `npm run grade`, `npm run explain`
and `apps/web` production build all pass.

**THE STUCK-MARKET FIXTURE IS CAPTURED AND THE EVIDENCE HELD.** Read on-chain
2026-09-02 00:27 UTC: market `0x27f6DE3d…` status 2 (Locked), `isResolved` false,
`isVoided` false, empty payout vector, 1503 tUSDC still backing, voidable since
2026-08-28T15:05:00Z and **4.4 days uncalled**. The indexer reported
`clobStatus: "Trading"` for the same market at the same instant. `npm run capture --
<marketId> [label]` writes the whole evidence set to `fixtures/`; graded BLOCK at
capture on `not-trading` + `cannot-settle`. `voidExpired()` is permissionless, so
grade the fixture, never the live market. Stop re-running the capture now that it is
committed; each run refreshes the timestamps.

**THE FIRM-DEPTH CLAIM MEASURES 0% ON THIS VENUE, AND THAT IS THE FINDING.** The
asymmetry is real (placement delegates via `placeBinaryOrderFor`, cancellation never
does and reverts `InvalidOrderOwner()`), but four verified facts cap the bucket at
zero. Measured on all 10 live markets, twice six minutes apart, identical: 1 owner
holding 100% of both sides, 6 orders, 1980 shares, TTL 11-28s, 0 past expiry.

1. Every owner is the same 291-byte **beacon proxy**, staticcalling
   `implementation()` on `0x8815c3f8…` and delegatecalling. Its own bytecode says
   nothing about what it can do, so a selector scan finding no cancel path would
   have been a false negative. This is the trap in the original write-up, worse than
   it anticipated.
2. The implementation `0x8635C413…` (26,589 bytes) carries `cancelOrder(uint128)`
   at three PUSH4 sites, none in its dispatch table, i.e. outbound. The owner
   cancels.
3. The beacon is upgradeable by `0xd58596620Ee…`, so a proxy owner can never be
   certified non-pullable.
4. `cancelExpiredOrders` / `sweepExpiredAtLevel` are permissionless, so firmness
   dies at `expireTimestampNs`. Firm-UNTIL-EXPIRY, never firm.

So `depthSignal` grades what varies: **phantom depth** (past expiry, still displayed,
still counted by every aggregated view, skipped by the matcher) at 10% elevated /
50% severe, and quote TTL below the measured 11-28s floor. Owner concentration is
reported on every market and deliberately never raises severity, because 1.00
everywhere is a venue constant and a signal that fires on everything says nothing —
the `imbalance = 0.000` mistake in a new costume.

**`getBinaryPoolParams()` returns `market` and `collateralToken` in one call.** No
two-hop `pool -> market -> collateral()` existed in the repo to fix; the correction
applied to `chain.ts`, which was being written.

**Five bugs, four of them in the checking layer.** The pattern from Stage 2-5 held.

1. `lapsedSec` measured from `expiry`, not `expiry + settlementWindow`. Inside the
   window a market is LATE and settlement is still expected; past it anyone can
   void. Ingestion now takes one extra `eth_call` for `settlementWindow()`, which
   neither the indexer nor `MarketOnchain` carries.
2. Every lapse rendered in minutes, so the stuck market read "expired 6328 min ago".
   `humanDuration` now gives "4d 10h", and the tense is present rather than
   conditional because the call is available right now.
3. **`scripts/` was never typechecked.** `npm run typecheck` claimed the whole
   workspace while all six gate scripts were invisible to it. `tsconfig.scripts.json`
   closes it and caught 5 real errors on its first run, 3 pre-existing.
4. **The explanation schema's `signal_id` enum was a hand-copied duplicate.** Adding
   `depth` broke the model path completely: 0 of 3 markets model-explained, and the
   Stage 5 gate still reported PASS because the fallback works as designed. Only the
   fallback-reason field showed it. Both now derive from `SIGNAL_IDS`.
5. **The 429 parser read milliseconds as seconds.** `/try again in ([\d.]+)s/i` — the
   trailing `s` matched the `s` of `ms`, so "412.5ms" became 412 seconds, blew the
   cap and skipped the retry. A market fell back over a 0.4-second pause. Unit-aware
   now, cap raised 30s → 45s (the TPM window is a minute), and asserted in
   `retry:test`.

Back to **3 of 3 model-explained on three consecutive runs**. Prompt trimmed
2,305 → 1,953 input tokens by sending `threshold basis` only for non-`ok` signals.
`EXPLAIN_BUDGET` 3 → 2, because ~2,000 in plus a 2,048 ceiling bills ~4,000 per call
against 8,000 TPM and a third call guarantees a 429.

**Design system applied: severity is INK, not a traffic light.** `ok` unmarked,
`elevated` a tonal bronze at hue 78, `severe` solid ink at the heaviest Zodiak
weight, `unknown` hollow with its sounding line running out of the frame. The ramp
is ink density and `unknown` is a different shape, so it survives greyscale. The
self-review caught the first amber at ~2.7:1 against paper; it is now ~4.8:1.

`label-caps` was on 34 elements doing four different jobs, which is the "one label
treatment everywhere" tell. Now data labels only; section headings get
`.section-mark` in Zodiak at sentence case, navigation and findings are plain
interface text.

The detail page states the book **twice**, "as displayed" then "as owned", because
the gap between those two readings is the product. Settlement moved out of the
sidebar into its own section above the trace. `quote life` earned a list column and
`last fill` lost one.

**Not verified: the two dynamic pages rendering in a browser.** The production build
compiles and typechecks, but `/` and `/m/[id]` are `force-dynamic`, so the build does
not render them. Run `cd apps/web && npm run dev` yourself and look.

**Do not start the dev server from a tool call in this repo.** Three launches in one
session (subshell `&`, harness background, `nohup &`) plus a `next build` stacked
Turbopack worker pools and crashed WSL.

## 2026-08-29 — Stage 3 scaffolded; three fixes from reading real output

`apps/web` is up: Next.js 16.2.6, React 19, Tailwind 4.3.3, bun, initialized from Samuel's own
shadcn preset (`b2JeaLOcVO`, style `base-rhea`). Primary is a real burnt orange —
`oklch(0.553 0.195 38.402)` light, `oklch(0.47 0.157 37.304)` dark — darker and redder than the
default amber. **It is the Base UI distribution, not Radix**: triggers take `render={<Button/>}`,
there is no `asChild`, so Radix-based shadcn blocks need porting rather than dropping in. Tailwind
v4 is CSS-first, so the theme lives in `app/globals.css` and there is no `tailwind.config.js`.
`components/ui` is deliberately empty — components get added per need, so nothing ships as a raw
default. The preset's font stack (Inter body, DM Sans headings) is **not** final; both are on the
anti-slop rejected list. Geist Mono stays.

**Three fixes, all found by reading actual output rather than assuming it was fine:**

1. **`windowElapsedElevated` was dead code.** Declared at 0.8, never read — only the severe check
   was in the condition — so a live market reading "35 min of trading left, 85% of the window
   elapsed" graded `ok`. Both paths now fire; 3 new fixtures, and an existing fixture corrected
   (99% elapsed is BLOCK, not RECHECK). 46 assertions.
2. **The discrimination check was testing variety, not an invariant.** It failed twice on healthy
   code: once when the venue rolled a generation where every market had never traded (one verdict
   *was* correct), then again when two genuinely different signal shapes both mapped to RECHECK
   (also correct — three verdicts, many shapes land in the middle). Now checks what actually
   matters: severities vary across markets, and the severity→verdict mapping holds in both
   directions.
3. **Groq was falling back on 2 of 3 markets every run.** `max_completion_tokens` counts against
   TPM as *requested*, not used — a 2,048 ceiling billed ~12,000 against a free-tier 8,000 limit
   when real output is ~1,200. Lowered to 1,400, added a 429 retry that waits exactly as long as
   Groq asks (it states the delay in the body and `retry-after`), and a transport retry for
   `TypeError: fetch failed` (same WSL flakiness as Stage 2). **3 consecutive runs, 3 of 3
   markets model-explained.** Was 1 of 3.

**Design direction is still open** — that is the next decision, not the next build. Memory from
Samuel's other projects gives the durable constraints: Geist + Geist Mono with `.font-data`
(tabular-nums) on every figure and `.label-caps` for micro-labels; amber/red for warnings only,
never decorative; shadcn primitives art-directed hard, never raw; no fabricated numbers.

## 2026-08-28 (later) — provider made configurable, Groq is the default

The repo no longer depends on any personal account setup. `.env` chooses the provider;
`npm run explain -- --offline` works with no key at all.

- **Groq is the default** (`GROQ_API_KEY`, free tier, no card). One adapter covers every
  OpenAI-compatible endpoint — OpenRouter, Together, Cerebras, DeepSeek, Ollama — so
  `LLM_BASE_URL` is the only thing that changes. Anthropic kept as explicit opt-in.
- **Two forcing mechanisms, verified against Groq's docs rather than assumed:** Anthropic uses
  `tool_choice` with a forced tool; Groq uses `response_format: json_schema` with `strict: true`
  (constrained decoding), because Groq documents structured outputs and tool use as **mutually
  exclusive**. Strict mode needs every property in `required` plus `additionalProperties: false`
  throughout — the existing schema already satisfied both, so one schema serves both paths.
- **Model choice matters:** default `openai/gpt-oss-120b` supports strict mode.
  `llama-3.3-70b-versatile` does **not** — it would silently degrade to best-effort JSON and
  lean on the guards instead of the schema. Check Groq's supported-model table before switching.
- The safety guarantee is untouched by the swap, which is the point: it lives in the **schema
  having no verdict field**, not in the provider or the model being good.
- `.env.example` added (blank values) so the config shape is documented without content.

**Guard false-positive rate, measured rather than assumed.** Ran the gate repeatedly and hit
~1 run in 3 losing a market to the fabricated-number check — every time on a figure that was
*real but rescaled*: `-0.414` cited as "41.4 points", `0.026` as "2.6", `0.095` as "9.5%".
Fixed on both sides: the system prompt now forbids unit conversion outright and tells the model
to describe magnitudes in words instead, and `allowedNumbers` admits every rescaling (abs value,
×100, ÷60, ÷3600) of every input figure. 5 further runs: 14 of 15 markets model-explained.

That is the third time the guard was wrong rather than the model. Worth stating plainly in the
demo: **a guard that rejects honest output is not a safety feature** — it silently downgrades
good work to the fallback, and you only notice by watching the fallback-reason field.

## 2026-08-28 — ✅ STAGE 5 COMPLETE — **MANDATORY CUTLINE CLEARED**

Stages 1–5 done. From here everything is upside: Stage 3 (dashboard) and Stage 6 (execution).

`npm run explain` — 3 markets explained by the model, verdict integrity PASS, all 5 guard
checks PASS. `npm run explain -- --offline` also passes (deterministic narrator).
`npm run test:risk` 42 assertions, `npm run grade`, `npm run typecheck` all clean. 14 commits.

**The design decision that matters: the model structurally cannot change the verdict.** Its
output schema has **no verdict, confidence, or numeric field** — it returns prose keyed to
signal ids, forced through `tool_choice: {type: "tool"}` so it cannot answer any other way.
There is no field it could write a verdict into.

That is deliberately stronger than "ask the model for a verdict and check it afterwards" — that
design leaves a disagreement to resolve, and someone has to decide who wins. Here the question
cannot arise. Worth saying exactly this way in the demo; it is the defensible core of the
product.

**Four guards on top**, because plausible-sounding wrong prose is the most damaging output this
thing can emit:
1. Every claim must cite a signal id that exists in the assessment.
2. Prose is scanned for verdict words contradicting the computed verdict ("safe to trade" under
   a BLOCK is rejected even though the verdict field is untouched).
3. Numbers in prose are checked against the evidence — catches fabrication.
4. Outcome predictions rejected outright. Plus: unmeasured signals described as "healthy" are
   caught — `unknown` must never read as reassuring.

**Fallback is a real fallback.** Any failure (no key, unreachable endpoint, malformed output,
guard rejection) lands on a deterministic narrator built from the same signals, with the reason
recorded in the trace. Degrades to plainer language — never to a wrong verdict, never to a blank
panel.

**The gate caught a real bug in my own guard.** A live run was rejected for citing `0.040` and
`0.282` — which are *genuine* venue distribution figures, from the `basis` calibration strings I
handed the model myself. The guard was wrong, not the model. `allowedNumbers` now includes
`basis` and `requiredChecks` text. Exactly why the guard needs its own adversarial test rather
than just existing.

**Note on the endpoint:** the explanation layer talks to whatever provider `.env` points it at
and reports the served model name in the trace. Provider config lives in `.env` only — never in
the repo or these notes.

Sample model output, unedited, on a market the engine graded RECHECK:

> *"Six of seven signals came back clean: correct venue, oracle question 46023 live and
> auditable, a 3.0-point spread on a 0.486 mid with 990 shares on the thinner side… The one
> exception is staleness — 2021 seconds since the last fill, 0.561 of the 3600-second window,
> at the top of the 0.040-median / 0.557-max range measured here."*

Every number there traces to a measured field. That is the whole point.

## 2026-08-28 — ✅ STAGE 4 COMPLETE (deterministic risk engine)

Took Stage 4 before Stage 3 so the dashboard renders real verdicts from day one.

`npm run calibrate` · `npm run grade` · `npm run test:risk` (42 assertions) — all pass.
`npm run typecheck` clean. 11 commits.

**Two threshold corrections the calibration sweep forced, both counter-intuitive:**

1. **Spread-over-mid is unusable at the tails.** A market at mid 0.019 with a 0.021 spread
   scores **113%**; mid 0.033 scores 65%; identical absolute spreads on mid 0.4 score 7%.
   Normalizing by mid makes cheap markets look catastrophic purely because the denominator is
   small. A binary payoff is fixed at 0/1, so **absolute probability points are the meaningful
   measure** and now lead. The ratio only catches the unplayable tail (spread ≈ mid, where a
   round trip costs the entire possible payout).
2. **Flow skew leads, depth imbalance corroborates** — inverting the textbook arrangement.
   Imbalance measured **exactly 0.000** on every symmetrically-quoted market (the maker ladder
   is symmetric by construction; it only moves once a side is partly consumed). A metric that is
   constant across a venue cannot discriminate. Skew ranged the full −1.00 to +1.00, the widest
   of anything measured.

Calibrated cut points, each justified by a measured distribution in `risk.ts`:
spread elevated 0.035 / severe 0.06 (venue normal is 0.021–0.029); depth 200/50 shares
(median 990); move 0.15/0.25 points (observed max 0.130 — so a ~10-point step is *normal* here);
staleness 0.35/0.6 of window (median 0.040, max 0.557); skew 0.6/0.9.

**Added two signals absent from the original spec**, both event-contract-specific: **window**
(a market can lock between snapshot and action — time left is a real risk, not a display
detail) and **venue** (one active venue runs zero-volume pricefeed tests; grading those as
tradable would be the most embarrassing possible failure).

**Three bugs the gates caught, all of them the kind that ship silently:**

- **ALLOW was issued to a market with volatility *and* order flow unmeasured** — a clean bill
  of health over two blind spots. Now *any* unmeasured signal withholds ALLOW. Costs us ALLOW on
  markets with <3 price buckets; correct trade, because ALLOW means `may_execute` and should
  mean we actually looked at everything.
- **One-sided flow alone reached BLOCK.** That is ordinary momentum, and blocking on it makes
  BLOCK meaningless. Severe now requires flow *and* resting depth to agree — which is also the
  only arrangement where the otherwise-constant imbalance metric earns its place.
- **Locked/Resolved markets emitted advice about position sizing and waiting for fills.**
  Nonsense on an untradable market, and filler in a trace is what makes it read as generated.
  They now advise redeeming.

**Why fixtures and not just live markets:** two consecutive `grade` runs gave
"ALLOW 5 / RECHECK 3 / BLOCK 2" then "ALLOW 6 / RECHECK 4 / BLOCK 0" from *identical code* — the
BLOCK cases were two markets that happened to be Locked at that moment. A gate that can only
test what the venue is currently doing cannot prove the dangerous paths work. `test-risk.ts`
constructs crossed books, superseded oracles, voided markets, lapsed settlement and wrong-venue
markets directly. Several we may never see live before Sep 8, and those are exactly the ones a
judge might ask about.

Design invariants now asserted, not just intended: ALLOW never co-occurs with an unmeasured
signal; only ALLOW permits execution; a crossed book reads `unknown` (a broken *read*, not a
risky market); confidence tracks observational completeness and never expresses a view on
whether the market resolves YES; every signal carries a `basis` string stating its calibration
justification.

## 2026-08-28 — ✅ STAGE 2 COMPLETE (ingestion)

`npm run snapshot` — **8 consecutive runs, 8 passes, 8 gradeable snapshots each.**
`npm run retry:test` — all checks pass. `npm run typecheck` clean. 7 commits pushed.

Shipped:

```
packages/ec/      5 vendored ec-core modules (read path only) + VENDORED.md
packages/core/
  indexer.ts      retry-wrapped GraphQL for OUR queries
  resilient.ts    retry-wrapped SDK calls (loadMarkets, getMarketOnchain)
  queries.ts      market/candle/fill/oracle queries, marketId-scoped
  book.ts         spread, depth, near-touch imbalance, executable size
  history.ts      price points, move, flow, freshness
  snapshot.ts     MarketSnapshot + provenance
  ingest.ts       assembles it all
scripts/          snapshot.ts (gate), retry-test.ts (retry proof)
```

**The bug worth remembering: I only retried half the reads.** `indexer.ts` wrapped the queries
we write, but `loadMarkets()` and `getMarketOnchain()` go through the SDK's *own* unretried
`postGraphql`. The gate failed **3 runs in 5**, every time inside
`loadMarkets → listRegistryMarkets → postGraphql` with `ETIMEDOUT`, while our wrapped queries in
the same pass succeeded. A resilient snapshot layer fed by fragile entry points looks robust
right up until the demo. `resilient.ts` now wraps every SDK call on the ingestion path; 2/5 → 8/8.

Note `withRetry` walks the `cause` chain and inspects `AggregateError.errors` — the SDK buries the
real reason two levels down (`IndexerError` → `TypeError: fetch failed` → `AggregateError` with
`code: ETIMEDOUT`), and Happy Eyeballs reports one error per attempted address.

**Live venue reading confirms the earlier measurements.** 8 markets, all `Trading`, spreads
2.5–2.9 points (4.9%–13.0% of mid), ladders ~990 shares near the touch on both sides. Fresh
findings from the run:

- **Mint-a-pair is real and visible** — 100–300 shares on three markets arrived via two opposite
  side *buyers* crossing with no seller, the pool minting the pair. Worth surfacing in the UI;
  it is genuinely unusual market structure and shows we understand the venue.
- **Candle sparsity is worse than assumed.** BTC 24h: 6 candles across 10 hours with a **4-hour
  gap**. Confirms no interpolation, and `moveMetrics` reports `insufficient` below 3 samples
  rather than a confident zero — which fires on most intraday markets.
- **Staleness varies hugely.** 24h markets traded 63s–4m ago; 4h markets 64–73m ago (~27–30% of
  their window). Vindicates expressing age relative to window length rather than in absolute
  seconds.
- **Imbalance reads exactly 0.000 on every market** — the ladder is symmetric (990 shares each
  side). So imbalance alone will not separate markets on this venue; the manipulation signal has
  to lean on `flow.skew` (taker direction), which does vary: −1.00 on one-sided markets, +0.32
  and +0.10 on the two 24h ones.

Two `.npmrc` notes: the configured registry (`registry.npmmirror.com`) took 15s+ per request and
`ETIMEDOUT` mid-install, so `.npmrc` pins `registry.npmjs.org` with longer timeouts and
`maxsockets=3`. It is gitignored as environment-specific.

## 2026-08-28 — ✅ STAGE 1 GATE CLEARED

`npm run ec:doctor` ran clean against Shannon. Venue resolved from env, 8 scoped markets,
on-chain status read, YES books snapshotted. `PRIVATE_KEY (not set)` is the expected read-only
path — the gate does not need a key.

```
venue : 0x679795a0… · source=env · scoped active=8
ETH-0-28AUG26-1145/tUSDC       Trading  ttl=6m    YES bid=0.053 ask=0.075
BTC-0-28AUG26-1145/tUSDC       Trading  ttl=6m    YES bid=0.111 ask=0.134
ETH-0-28AUG26-1200-BDF2/tUSDC  Trading  ttl=21m   YES bid=0.140 ask=0.164
BTC-0-28AUG26-1200-BDF1/tUSDC  Trading  ttl=21m   YES bid=0.578 ask=0.608
BTC-0-28AUG26-1200-BC21/tUSDC  Trading  ttl=21m   YES bid=0.231 ask=0.257
ETH-0-28AUG26-1200-BC22/tUSDC  Trading  ttl=21m   YES bid=0.922 ask=0.943
ETH-0-29AUG26/tUSDC            Trading  ttl=741m  YES bid=0.318 ask=0.351
BTC-0-29AUG26/tUSDC            Trading  ttl=741m  YES bid=0.144 ask=0.169
```

Matches what I measured on the indexer beforehand — venue id, market count and book shape all
line up, so nothing moved between verification and the run.

**First run failed with `ETIMEDOUT`; it is transient, not misconfiguration.** Root cause: the
SDK's `postGraphql` does exactly one `fetch` with **no retry**, so any single hiccup kills the
whole `loadMarkets()`. Measured ~1 run in 3 failing, with *varying* failure modes (`ETIMEDOUT`
once, `response was not JSON` later). The indexer is healthy — 15/15 heavy sequential queries
and 30/30 concurrent all returned 200 with complete JSON. **Stage 2 must wrap every indexer
read in retry-with-backoff and show a degraded state rather than an empty screen.** Details in
[dreamdex-surface.md](dreamdex-surface.md).

Secondary: IPv6 is unreachable on this WSL2 box (NAT64 `64:ff9b::8e9:b213`, `ENETUNREACH`), and
Node 24 races it with a 250ms Happy Eyeballs timeout. Pinning IPv4 cuts warm latency ~850ms →
~220ms but does **not** fix the flake. Optional:
`NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"`.

**The stale-book finding is now proven by A/B, not inferred.** Same two markets, seconds apart:
indexer `Order` rows gave ETH 24h bid 0.320 / ask **0.270** — a crossed book, impossible — while
the materialized book gave 0.318 / 0.351. The indexer's bid was roughly right and its ask stale
by 8 points. A risk engine reading those rows computes a negative spread and grades a healthy
market as manipulated.

**Symbol format decoded** (undocumented):
`ASSET-STRIKE-DDMMMYY[-HHMM][-IDSUFFIX]/COLLATERAL`. `STRIKE` is `0` because these settle
against their own opening price. The `-BDF1` / `-BC21` suffix is the low bytes of `marketId`,
appended when two windows share a wall-clock expiry (15m and 4h series both land on 12:00).
Don't parse it — use the typed fields.

## 2026-08-28 (Stage 1 setup) — repo live, wallet generated, awaiting funding

- GitHub repo created **public**: https://github.com/Sammy949/fathom (pushed, `main`).
- Bot Kit cloned to `~/dev/dreamdex-bot-kit` (`--depth 1`, HEAD `dccd2fd`) as a **reference
  sibling**, not a dependency. Its `.env` is written with the throwaway key and
  `VENUE_ID=0x679795a0…`, `DRY_RUN=true`, `chmod 600`, and its own `.gitignore` covers `.env`.
- **Decision: vendor the ec-core modules we need** into `fathom/packages/ec/` rather than
  linking the workspace. `@dreamdex-bot-kit/ec-core` is `private: true`, unpublished, and its
  `main` points at raw `.ts` that only resolves inside the Bot Kit workspace — a `file:`
  dependency on it cannot build on Vercel. It's MIT, we need to modify thresholds and add our
  own risk fields anyway, and one repo means one tsconfig and one deploy. Tradeoff accepted: we
  own the diff if upstream fixes something. ~1,600 lines total across 10 files; we need roughly
  6 of them (`config`, `addresses`, `markets`, `orders`, `gotchas`, `settlement`).
- **Build wallet: `0xC3d33eB15B59a092cC5663fAdF5BcAeBa5afF010`** (MetaMask, Somnia testnet).
  Confirmed fresh on-chain — nonce 0 and zero balance on Shannon, Somnia mainnet, and Base, so
  nothing is at risk from testnet use. The earlier throwaway key was **discarded**: the STT
  faucet at testnet.somnia.network requires a **connected wallet** (no paste-an-address path),
  so a bare keypair cannot be funded. Key material deleted.
- `PRIVATE_KEY` in the Bot Kit `.env` is deliberately **left blank**. `ec:doctor` is read-only
  and runs fine without it. Fill it in only at Stage 6, and only if that MetaMask account holds
  nothing on any mainnet — otherwise use a second MetaMask account for Shannon.
- **Faucet mechanics, measured** (details in [dreamdex-surface.md](dreamdex-surface.md)):
  tUSDC `faucet(uint256)` caps at **exactly 10,000 tUSDC per call** — `10000000001` raw reverts
  with `FaucetCapExceeded()` (selector `0x37583762`), found by binary-searching `eth_call` since
  no cap getter is exposed. Call repeatedly for more. `faucet()` costs ~1.38M gas ≈ 0.0083 STT
  at 6 gwei; an order is ~200k ≈ 0.0012 STT. One STT drip covers hundreds of operations.
- **Two live Shannon RPCs**, both verified `chainId 50312`, heights ~20 apart:
  `dream-rpc.somnia.network` (Somnia's wallet-facing one, use in MetaMask) and
  `api.infra.testnet.somnia.network` (bot-kit default, keep in `.env`).
- **Verified on-chain** (not just from the notes): `binaryModule 0x3ecC694C…` and
  `oracleHub 0xe40db387…` both have code; collateral `0x70a86D88…` reports `name() = "Test
  USDC"`, `symbol() = "tUSDC"`, `decimals() = 6`. The bundled address map is current.
- Blocked on the **STT faucet** — needs the MetaMask wallet connected at
  testnet.somnia.network. Alternatives if rate-limited: Stakely, thirdweb, Google Cloud
  (`cloud.google.com/application/web3/faucet/somnia/shannon`), or Somnia Discord `#dev-chat`.
  `ec:doctor` clears the Stage 1 gate unfunded regardless.

## 2026-08-28 (later) — docs verified against live sources

Full verified integration surface: [dreamdex-surface.md](dreamdex-surface.md). Read it before
writing any client code.

**The brief was wrong in three ways, all now corrected in place:**
1. **Event Contracts have no REST API and no auth flow.** `api.dreamdex.io/v0` + SIWE is
   **spot only** — the docs say the HTTP API "has no event-contract endpoints." EC is a
   GraphQL indexer (`dev.smk.somnia.host/v1/graphql`) plus direct on-chain reads via viem.
   Auth is a private key, full stop. **This is a real architecture change for Stage 2.**
2. **`placeOrder` as documented is the spot signature.** EC unified tier is `createOrder(...)`;
   raw tier is `trader.placeOrder({ pool, side, price, quantity, orderType,
   expireTimestampNs })` with `side` ∈ `BUY_YES | SELL_YES | BUY_NO | SELL_NO`.
3. **No Python client for event contracts** — `ec-core` is TS only. Independently confirms the
   locked TS decision.

Also: **docs.dreamdex.io fetches fine.** The "blocks automated fetching" note was wrong. Append
`.md` to any path; index at `/llms.txt`.

**Other findings worth remembering:**
- Testnet collateral is **TestUSDC** (6 dp) with a public `faucet(uint256)`, not USDso. Funding
  is a contract call, not a swap.
- The 6-vs-18 decimal gap hides a real bug: float prices are rejected on mainnet
  (`InvalidPrice`) and fine on testnet. A clean testnet run proves nothing about the price path.
  Pin `@somnia-chain/markets-sdk` ≥ 0.28.0 (current 0.28.1) and use `ec-core`'s `placeLimit`.
- **Indexer `Order` rows are not a usable order book.** Live query showed bids at 0.496
  alongside asks at 0.082, all `status: Open`. Depth/spread/imbalance must come from
  `fetchOrderBook` or a chain read. Logged as a hard constraint in product-fathom.md.
- **Resolution risk as "ambiguous wording" is dead.** Every market asks the same templated
  question and the docs say don't parse it. Re-pointed at oracle binding /
  `supersededByQuestionId` / `voidPolicy` / settlement-window lapse / multi-source agreement.
- Every settlement is auditable at
  `prd.oracle.somnia.host/questions/{oracleQuestionId}?view=graph` — sources, values, median,
  agreement count. The decision trace should link it.
- Wide spreads are **normal** here (7 points on a 0.57 mid). Calibrate thresholds to this
  venue or everything grades BLOCK.

**Venue + demo markets picked** (live data, real venue
`0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c`, operatorId 2): BTC 24h,
BTC 4h, ETH 24h. The other active venue runs zero-volume 60s pricefeed tests — avoid.

Repo initialized at `/home/samy/dev/fathom`, notes committed.

## 2026-08-28
- Created `/home/samy/dev/fathom` + `notes/`.
- Name locked: **Fathom**. Product framing locked: agent-first, dashboard-presented risk
  copilot for DreamDEX Event Contracts. See [product-fathom.md](product-fathom.md).
- Hackathon facts captured in [hackathon-brief.md](hackathon-brief.md). Deadline **Sep 8
  19:00 WAT**. Registered.
- Calendar: both dates already added (WAT), per earlier session.

## Open decisions
- [ ] Effort split across the three overlapping builds (Somnia/Fathom, Telegraph ~Sep 7,
      Midnight Sep 16). Decide before committing hours.
- [x] TS vs Python for the SDK client — **TS**, and it was never really a choice: `ec-core`
      (the event-contracts client) is TS only. `packages/core-py` is the spot side.
- [x] Which Event Contract markets to target — BTC 24h, BTC 4h, ETH 24h on venue
      `0x679795a0…` (operatorId 2). See product-fathom.md.

## Immediate next steps
1. **Decide the design direction** — the only thing blocking the dashboard build. Open questions:
   which reference system (audit-document / lab-report, Debrief's Editorial Technical adapted to
   orange, or a `styles.refero.design` reference); whether to replace the preset's Inter + DM Sans
   with Geist + a distinctive display face; and whether "depth" is a real signature or twee.
2. **Then Stage 3 — the dashboard.** Everything it needs exists: `DecisionTrace` carries signals with
   measured value + calibration basis + plain reading, the rule path, per-field provenance, and
   the oracle receipt URL. Design around real output, not placeholder chrome. UX/Design is 20% of
   the score and the anti-slop law applies — decide a real signature first.
2. **Stage 6 (stretch)** — gated `placeLimit` execution. Needs the funding steps below.
3. Consider surfacing the *provenance* row in the UI — "which of these numbers is fresh" is a
   genuinely unusual thing for a dashboard to show and it is already computed.
4. **Set `GROQ_API_KEY` in `.env`** for model-written explanations (free key at
   console.groq.com/keys). Everything runs without it via the fallback narrator.
5. **Funding, only needed for Stage 6:** STT gas (faucet needs MetaMask connected at
   testnet.somnia.network, wallet `0xC3d33eB15B59a092cC5663fAdF5BcAeBa5afF010`) then tUSDC via
   `faucet(uint256)` (10,000 cap per call, needs `PRIVATE_KEY` set in `.env`). Use a second
   MetaMask account rather than one holding anything real.

## Commands
| Command | What it does |
|---|---|
| `npm run snapshot` | Stage 2 gate — ingest + provenance, lists live venues |
| `npm run capture -- <marketId> [label]` | Freeze one market's whole evidence set to `fixtures/` |
| `npm run calibrate` | Threshold sweep — per-market rows + distributions |
| `npm run probe:book` | Book-read stability — polls one a second for 90s, counts what would have graded severe |
| `npm run grade` | Stage 4 gate — verdicts, decision traces, discrimination check |
| `npm run explain` | Stage 5 gate — full traces + verdict-integrity + guard proof |
| `npm run explain -- --offline` | Same, deterministic narrator only (no key needed) |
| `npm run test:risk` | 89 assertions over synthetic snapshots plus the frozen fixture, no network |
| `npm run retry:test` | Proves retry distinguishes transient from terminal |
| `npm run typecheck` | Whole workspace, `scripts/` included |
| `cd apps/web && npm run dev` | The dashboard. Run this yourself; see the note above |

## Links
- Hackathon: https://dorahacks.io/hackathon/event-contracts/detail
- Bot Kit: https://github.com/somnia-chain/dreamdex-bot-kit
- Docs: https://docs.dreamdex.io/developers/event-contracts (index: /llms.txt)
- Testnet faucet (gas): https://testnet.somnia.network
- Testnet indexer: https://dev.smk.somnia.host/v1/graphql
- Oracle explorer: https://prd.oracle.somnia.host/questions/{oracleQuestionId}?view=graph
