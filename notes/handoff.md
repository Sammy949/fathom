# Fathom — Handoff Log

Running log of state + decisions + next actions. Newest at top.

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
1. Clone the Bot Kit, `npm install`, `cp .env.example .env`, set `PRIVATE_KEY` +
   `NETWORK=testnet`, keep `VENUE_ID=0x679795a0…`.
2. Fund the wallet: STT for gas from testnet.somnia.network, then TestUSDC via
   `faucet(uint256)` on `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`.
3. `npm run ec:doctor` — the Stage 1 gate. Confirm resolved venue, live markets, on-chain
   status, and a YES book snapshot. Read-only, sends nothing.
4. Re-verify `VENUE_ID` off a live market row at the start of each session — the ids move.
5. Then Stage 2 per the implementation sequence.

## Links
- Hackathon: https://dorahacks.io/hackathon/event-contracts/detail
- Bot Kit: https://github.com/somnia-chain/dreamdex-bot-kit
- Docs: https://docs.dreamdex.io/developers/event-contracts (index: /llms.txt)
- Testnet faucet (gas): https://testnet.somnia.network
- Testnet indexer: https://dev.smk.somnia.host/v1/graphql
- Oracle explorer: https://prd.oracle.somnia.host/questions/{oracleQuestionId}?view=graph
