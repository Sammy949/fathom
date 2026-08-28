# Hackathon Brief — Somnia x DreamDEX Event Contracts

Source: https://dorahacks.io/hackathon/event-contracts/detail#what-to-build

## The essentials
- **Prize pool:** $5,000 USD
- **Format:** Virtual. Individual or team.
- **Type:** DeFi / Event Contracts / Prediction Markets

## Dates (WAT)
- Pre-registration opened: 2026-08-18 01:00
- Submission window opens: 2026-08-25 01:00
- **Final deadline: 2026-09-08 19:00** ← hard cutoff
- Status: registered ✅

## Build target
Something meaningful on **DreamDEX Event Contracts** — prediction markets running on
**Somnia**, an EVM-compatible L1. In scope: trading apps, AI trading agents, analytics
tools, social prediction products. A shallow wrapper won't score; they want real SDK usage.

## Deliverables
- Testnet prototype
- GitHub repo
- 2–3 min demo video
- Optional (count toward polish): pitch deck + SDK feedback report

## Judging weights
| Criterion | Weight |
|---|---|
| Technical Implementation | 25% |
| Innovation | 20% |
| UX / Design | 20% |
| Business / Ecosystem Impact | 20% |
| Presentation | 15% |

Heaviest: technical depth (25%) + ecosystem impact (20%).

## Dev resources
- **Bot Kit:** github.com/somnia-chain/dreamdex-bot-kit (TS + Python for spot; **TS only** for
  event contracts, via `packages/ec-core`)
- **Docs:** docs.dreamdex.io — fetches fine, contrary to the earlier note. Append `.md` to any
  path for markdown; full index at `docs.dreamdex.io/llms.txt`. EC pages:
  `/developers/event-contracts{,/recipes,/market-structure,/gotchas,/contracts-and-addresses}`
  and `/trading/event-contracts/settlement-and-voids`.
- **Community:** Telegram dev channel — source of test STT tokens + questions
- **Testnet:** Shannon, chain ID **50312**. Gas (STT) from testnet.somnia.network; trading
  collateral is **TestUSDC** `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` (6 dp) with a public
  `faucet(uint256)` — a contract call, not a swap.

## SDK surface

⚠️ **This section was written from the Bot Kit README and is wrong in three places.** The
verified surface lives in [dreamdex-surface.md](dreamdex-surface.md) (checked 2026-08-28
against the live docs, the repo, npm, and live indexer queries). Read that, not this.

The short version of what changed:
- **No REST API and no auth flow for Event Contracts.** The `api.dreamdex.io/v0` + SIWE
  surface is **spot only**. EC goes through a GraphQL indexer (`dev.smk.somnia.host`) plus
  direct on-chain reads. Auth is a private key, nothing else.
- **`placeOrder` as described is the spot signature.** EC uses
  `exchange.createOrder(symbol, "limit", side, size, price, opts)`, or the raw
  `trader.placeOrder({ pool, side, price, quantity, orderType, expireTimestampNs })` with
  `side` ∈ `BUY_YES | SELL_YES | BUY_NO | SELL_NO`.
- **No Python client for Event Contracts.** `ec-core` is TS only; `packages/core-py` is spot.
  Independently confirms the locked TS decision.

Still accurate: DreamDEX is an on-chain **CLOB**, Event Contracts are the prediction-market
instrument traded on it, and every reference strategy defaults to `DRY_RUN=true`. There are
six `ec-*` strategies (the README's "five" was the spot count).

## Stack fit
EVM-compatible, and the SDK is **viem**-based (not ethers) — `@somnia-chain/markets-sdk`
takes viem as a peer dep and `ec-core` builds on it. EVM concepts carry over from the
ethers.js v6 work; the exact API surface does not. Prediction markets are a **new primitive**
regardless — not a straight extension of the Aave-reading work Anchor does.

## Scheduling reality — three builds converging
- **This (Somnia):** deadline Sep 8
- **Telegraph:** build window through ~Sep 7
- **Midnight:** deadline Sep 16 (front end overlaps)

Roughly a two-week window with three live builds. Decide the effort split deliberately, not
mid-crunch.
