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
- **Bot Kit:** github.com/somnia-chain/dreamdex-bot-kit
- **Docs:** docs.dreamdex.io/developers/event-contracts (blocks automated fetching — skim manually)
- **Community:** Telegram dev channel — source of test STT tokens + questions
- **Testnet:** Shannon, chain ID **50312**. Free funds from testnet.somnia.network

## SDK surface (from the Bot Kit repo)
- DreamDEX is an on-chain **CLOB** (central limit order book). Event Contracts are the
  prediction-market instrument type traded on it.
- Shared client in **TS and Python**: auth, REST, WebSocket, order execution, nonce mgmt.
- Live market data: `GET /v0/markets` + WebSocket feeds.
- Orders go through a single **`placeOrder`** entry point — auto-pulls funds, no separate
  deposit step.
- Five reference strategies exist (market-making, grid, momentum, mean-reversion, TWAP),
  all `DRY_RUN=true` by default.

## Stack fit
EVM-compatible, so ethers.js v6 experience carries over directly. Prediction markets are a
**new primitive** though — not a straight extension of the Aave-reading work Anchor does.

## Scheduling reality — three builds converging
- **This (Somnia):** deadline Sep 8
- **Telegraph:** build window through ~Sep 7
- **Midnight:** deadline Sep 16 (front end overlaps)

Roughly a two-week window with three live builds. Decide the effort split deliberately, not
mid-crunch.
