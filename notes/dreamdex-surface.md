# DreamDEX Event Contracts — verified integration surface

Verified 2026-08-28 against `docs.dreamdex.io` (live), the `dreamdex-bot-kit` repo at
`pushedAt 2026-08-24`, npm `@somnia-chain/markets-sdk@0.28.1`, and live queries against the
Shannon testnet indexer. **Supersedes the "SDK surface" section of
[hackathon-brief.md](hackathon-brief.md), which was written from the Bot Kit README and is
wrong in three places** (flagged below).

## The one thing that changes the architecture

**Event Contracts have no REST API and no auth flow.** The DreamDEX HTTP API
(`api.dreamdex.io/v0`, SIWE/`Bearer` token) **covers spot only — no event-contract
endpoints.** Quoting the docs: the HTTP API "covers spot only and has no event-contract
endpoints."

Event contracts are reached two ways, both of which we drive from TS:

| Source | What it is | Use it for |
|---|---|---|
| **Hasura/GraphQL indexer** — `https://dev.smk.somnia.host/v1/graphql` (testnet), `https://prd.smk.somnia.host/v1/graphql` (mainnet) | Indexed market rows, fills, candles, oracle answers, resolution events. **Lags the chain by seconds.** | Discovery, history, charts, settled-market sweeps |
| **On-chain via viem** — RPC `https://api.infra.testnet.somnia.network`, WS `.../ws` | Authoritative status, balances, order book materialized from logs | Anything we act on, and every write |

**Auth is a private key, nothing else.** `new SomniaMarkets({ indexerUrl, chain, wsRpcUrl,
addresses, privateKey })`. No API key, no nonce/login, no bearer token. "There are no API
rate limits" and the public RPCs are unthrottled. The SIWE block in the Bot Kit `.env.example`
belongs to the **spot** side only.

### Corrections to hackathon-brief.md
1. ~~"Live market data: `GET /v0/markets` + WebSocket feeds"~~ — spot only. EC uses the
   GraphQL indexer + chain logs.
2. ~~"Orders go through a single `placeOrder` entry point"~~ — that is the **spot** CLOB
   signature. EC unified tier is `exchange.createOrder(symbol, "limit", side, size, price,
   opts)`; raw tier is `exchange.trader.placeOrder({ pool, side, price, quantity, orderType,
   expireTimestampNs })` with `side` ∈ `BUY_YES | SELL_YES | BUY_NO | SELL_NO`.
3. ~~"Shared client in TS and Python"~~ — `@dreamdex-bot-kit/ec-core` is **TS only**.
   `packages/core-py` is the spot client. Python was never an option for event contracts,
   which independently confirms the locked TS decision.

## Packages and versions

```
@somnia-chain/markets-sdk   0.28.1   (published 2026-08-21)  ← pin >= 0.28.0, see below
@dreamdex-bot-kit/ec-core            (workspace pkg in the bot kit, wraps the SDK)
viem                                 peer dep
```

Version floors are hard, not advisory:
- **< 0.23.0** — reads fail outright (indexer dropped the `longOpenInterest` column those
  versions still request).
- **< 0.28.0** — float prices miss the tick grid and get rejected as `InvalidPrice`.
  `(0.05).toFixed(18)` is `"0.050000000000000003"`. Of fifteen ordinary probabilities only
  0.25 / 0.5 / 0.75 survive, because those are exact in binary floating point.

**This bug is invisible on testnet** (6-decimal collateral) and fatal on mainnet
(18-decimal). Do not treat a clean testnet run as proof the price path is correct.

## Network + address facts

| | Testnet (Shannon) | Mainnet |
|---|---|---|
| Chain ID | `50312` | `5031` |
| RPC | `https://api.infra.testnet.somnia.network` | `https://api.infra.mainnet.somnia.network` |
| WS | `wss://api.infra.testnet.somnia.network/ws` | `wss://api.infra.mainnet.somnia.network/ws` |
| Indexer | `https://dev.smk.somnia.host/v1/graphql` | `https://prd.smk.somnia.host/v1/graphql` |
| Collateral | **TestUSDC** `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`, **6 dp**, public `faucet(uint256)` | USDso `0x00000022dA000002656c64D9eA6011ea952D008A`, 18 dp |
| Gas token | STT (faucet: testnet.somnia.network) | SOMI |

Protocol core is CREATE3-deterministic and identical on both chains (`binaryModule
0x3ecC694Cef705358864a646142ac17A90E29e388`, `oracleHub
0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b`, others in `ec-core/src/addresses.ts`).

**Collateral on testnet is TestUSDC, not USDso**, and it has a public faucet — so funding is
a contract call, not a swap. The docs' "acquire USDso by swapping on a live market" advice is
the spot/mainnet path.

## Venue scoping — the thing that silently returns zero markets

One deployment hosts several venues and their markets sit side by side in the indexer.
`VENUE_ID` is required or `ec-core` refuses to guess. **Venue ids move** — both networks
changed theirs three times in the first week of August.

Confirmed live on testnet right now, six venues carry binary markets. Two are active:

| venueId | operatorId | What's on it |
|---|---|---|
| `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c` | 2 | **The real one.** `strike: 0`, question `"BTC closes at or above its opening price"`. Intervals 900 / 3600 / 14400 / 86400s. Real trades and multi-level books. |
| `0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f` | 4 | `"Pricefeed test: will ETH/USDC's price be at or above 2485.26 at unix time …"` — a numeric strike, 60s/300s windows, zero volume. Test scaffolding, **not** a demo candidate. |

The `.env.example` testnet value **is** `0x679795a0…`, and that is still correct as of today.
Re-verify before every session; if a bot reports no markets, read `venueId` off a live market
row rather than trusting the file.

## Market shape and lifecycle

Contract family per window: `BinaryMarketsModule` (registry, `markets(marketId)`, routes
mint/merge/redeem) → a per-window market contract → a pool (the CLOB, holds all escrow) →
`OutcomeToken6909` (one shared ERC-6909; Up/Down are token **ids**, not separate ERC-20s).

Status enum: `0 Listed · 1 Trading · 2 Locked · 3 Settling · 4 Resolved · 5 Voided`
(`3` exists but is effectively never observable). **Only `Trading` accepts orders; `Locked`
still allows cancels.** Transitions are time-derived on-chain, so indexed status trails by
seconds — gate every write on `getMarketOnchain(marketId)`.

Identity: `bytes32 marketId`, a module-scoped counter. **Key all state by `marketId` or
symbol, never by pool address** — pools return to a free list and are recycled across
consecutive windows of the same series. Use `(poolAddress, nonce)` to tell successive markets
apart.

One book, quoted in **YES/Up probability terms** in `(0, 1)`; a Down price is `1 − up`. Four
crossing paths, and the interesting one: two opposite-side *buyers* can match with no seller
at all — the pool mints a fresh Up/Down pair from their combined collateral. Complete sets
convert `1 collateral ⇄ 1 Up + 1 Down` (`mintSet` / `burnSet`, the merge is named *burn*).

## Settlement — this is what the resolution-risk signal must actually read

Judged against **the window's own opening price**: "if the settlement price is at or above
it, Up wins; below it, Down wins." The settlement price comes from "a multi-source price
reference — never a single exchange tick," and "each market's reference and result are
published, so every settlement can be checked."

At expiry the oracle posts the answer, Somnia's on-chain reactivity fires the oracle hub
callback, the hub forwards to `BinaryMarketsModule` (the sole trusted settler), and
finalization plus redemption open in the same flow. Resolution gas is prepaid at creation.

Backstops:
- `pokeOracle(questionId)` — pull an answer that was posted but not applied.
- `voidExpired()` — callable by **anyone** once the settlement window lapses with nothing
  posted.

Voids: triggered when a dependable settlement price can't be established in the window; the
market "voids rather than settling on bad data." Both sides redeem at **0.5 each**, no fee is
taken, and "a voided market is a refund, not a loss."

Payouts are **claimed, not received** — a settled position does not decay into collateral on
its own. Settled markets leave the live list, and `loadMarkets()` skips finalized binaries
outright, so a redeem-by-scan bot silently finds nothing. Use
`listBinaryMarkets({ status: "Finalized" })`; note `"Resolved"` returns nothing because
resolution auto-finalizes. A losing redeem succeeds and pays zero without reverting.

Audit trail per market: `oracleQuestionId` →
`https://prd.oracle.somnia.host/questions/{oracleQuestionId}?view=graph` shows the recorded
question, every price source and its returned value, the median across them, how many sources
had to agree, and which side that median favored. **This is the receipt the decision trace
should link to.**

## The resolution-wording finding (affects the product spec)

Every market on the live venue asks the **same templated question** —
`"BTC closes at or above its opening price"` with `strike: 0`, typed `asset` and
`intervalSec` fields carrying the real parameters. The docs are explicit: **do not parse the
question text**, its wording has been revised repeatedly while the typed fields stayed
stable.

So "ambiguous wording" as a risk signal is close to dead weight on this venue. Re-pointed in
[product-fathom.md](product-fathom.md) at the things that actually vary per market: oracle
question binding and `supersededByQuestionId`, `voidPolicy`, settlement-window lapse risk,
time-to-expiry against the lock boundary, and whether the market sits on the real venue or
the pricefeed-test one.

## Live testnet reading (2026-08-28 ~11:30 WAT)

12 unfinalized markets with a future expiry; 8 on the real venue. Intervals and their
usefulness to us:

| Interval | Demo value |
|---|---|
| 60s, 300s | Useless — expires before a judge finishes reading the verdict. Also only on the pricefeed-test venue. |
| 900s (15m) | Marginal. Fresh books, zero trades. |
| **3600s (1h)** | Usable. 4–5 trades, three levels each side. |
| **14400s (4h)** | **Good.** 11 trades, 10 bids / 3 asks, visible imbalance. |
| **86400s (24h)** | **Good.** 16 trades, deepest book, survives a whole demo session. |

Typical shape on the real venue: three ladder levels each side at ~200/330/460 shares, plus
smaller organic 2–30 share orders. Spreads run wide — BTC 15m sat 0.536/0.607, a **7-point
spread on a 0.57 mid**. Wide spreads are the *normal* state here, so the liquidity thresholds
have to be calibrated against this venue rather than against a real-money book, or every
market grades BLOCK and the verdict says nothing.

## Order placement, if we reach Stage 6

Prefer `placeLimit` from `ec-core` over the SDK's unified `createOrder`: it converts in tick
and lot integer units through the raw trader tier (dodging the float bug), checks the wallet
before signing, and folds in the expiry cap and the receipt check.

Sharp edges that will cost us time:
- **A reverted write does not throw.** SDK writes sign with fixed fees and skip simulation.
  On the unified tier the receipt is **not** on the returned order — it rides on
  `(order.info as PlaceOrderResult).receipt`, and `order.receipt` is always `undefined`,
  which quietly kills the check. `ec-core`'s `assertTxOk` handles this.
- **`expireTimestampNs` is mandatory**, unix nanoseconds, future-dated, capped at the
  market's own expiry. `0` reverts with `OrderAlreadyExpired`.
- **IOC vs resting is a decision.** An unfilled limit remainder rests with escrow locked,
  invisibly if you aren't tracking open orders.
- **Quantize size yourself.** The SDK's generic `amountToPrecision` skips lot sizing on binary
  markets; sub-lot sizes floor to **zero** with nothing thrown. Use `ec-core`'s `quantize` and
  skip when it returns 0.
- A crossing `post-only` **throws** rather than returning a status (`PostOnlyWouldCross()`);
  on a quoting loop that is a normal event, not a fault.
- Takers pay the **fill** price, not the price they offered (0.945 paid on a 0.98 bid against
  a 0.945 ask). Cancels return exact escrow to the wallet; the per-pool vault reads 0 in
  normal operation but is drawn first if funded.
- **Avoid markets near close** — a short window can lock between snapshot and send.

## Data-source trap we hit while verifying

The indexer's `Order` rows with `status: "Open"` are **not** a usable order book. Queried live
on BTC 4h: bids resting at 0.496 / 0.486 / 0.475 alongside asks at 0.082 / 0.075 / 0.066, all
`status: Open`, `filledQuantity: 0`. A book cannot be crossed by 40 points — those rows are
stale relative to the chain.

So the depth, spread and imbalance metrics must come from the SDK's materialized book
(`fetchOrderBook`, which hydrates an indexer snapshot then replays chain logs) or from an
on-chain read. **Not** from indexer `Order` rows. This is the single most likely way the risk
engine ships confidently wrong numbers.

Also: `tickSize`, `lotSize` and `minQuantity` are **null** on every binary market row —
unlike spot. They are not discoverable through the SDK and come from config
(`MM_TICK` / `MM_LOT`). Testnet measured down to 1 raw unit (no practical lot constraint);
mainnet is 1e15 for both.

## Useful indexer tables

`Market` (typed: `asset`, `strike`, `intervalSec`, `expiry`, `tradingStart`, `venueId`,
`operatorId`, `finalized`, `voided`, `winningOutcome`, `yesTokenId`, `noTokenId`,
`poolAddress`, `nonce`, `lastPrice`, `tradeCount`, `cumulativeQuoteVolume`, `clobStatus`),
`Fill`, `Candle`, `Order`, `OutcomeBalance`, `OracleQuestion` (incl. `supersededByQuestionId`,
`voided`), `OracleAnswer` (`numericValue`, `outcomeIdx`, `voidReason`, `voided`),
`MarketResolutionEvent`, `MarketStatusUpdate`, `MarketVenue`.

Bucket sizes for `getCandles(pool, …)`: 60, 300, 900, 3600, 14400, 86400. Candles and fills
are keyed on the **pool**, and one pool has already served ~100 markets — always bound the
window or filter rows by market.

## Bot Kit inventory (for reference, we are not running these)

Six `ec-*` strategies: `ec-starter`, `ec-maker`, `ec-passive`, `ec-settlement`,
`ec-oracle-follow`, `ec-laddering-bot`. Nine spot ones. All default `DRY_RUN=true`.
(The brief said "five reference strategies" — that was the spot count at README time.)

Read-only preflight: `npm run ec:doctor` → `scripts/ec-doctor.ts`. Sends no transactions;
prints network, indexer, resolved venue + how it was chosen, wallet gas + collateral
balances, then per-market on-chain status, time left, and a YES book snapshot. This is our
Stage 1 gate.

`ec-oracle-follow` needs an underlying BTC/ETH spot feed that no market row carries. The SDK
bundles `SOMNIA_TESTNET_PRICE_FEED` for **testnet only**; on mainnet the strategy exits at
startup. If Fathom's volatility signal wants the underlying rather than just the implied
probability, that feed is the testnet-only source.
