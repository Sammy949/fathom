# Fathom — Handoff Log

Running log of state + decisions + next actions. Newest at top.

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
- [ ] TS vs Python for the SDK client (Bot Kit ships both). Leaning TS to reuse ethers.js v6
      + share types with a React dashboard.
- [ ] Which small set of Event Contract markets to target for the demo.

## Immediate next steps
1. Skim docs.dreamdex.io/developers/event-contracts manually (blocks auto-fetch). Pull
   settlement mechanics + contract types — needed for the Resolution-risk signal.
2. Clone `github.com/somnia-chain/dreamdex-bot-kit`.
3. Run `npx tsx scripts/doctor.ts` against Shannon (chain 50312) to see live Event Contract
   markets and confirm auth.
4. Get test STT tokens (Telegram dev channel + testnet.somnia.network).
5. Then Stage 1 → 2 per the implementation sequence.

## Links
- Hackathon: https://dorahacks.io/hackathon/event-contracts/detail
- Bot Kit: https://github.com/somnia-chain/dreamdex-bot-kit
- Docs: https://docs.dreamdex.io/developers/event-contracts
- Testnet faucet: https://testnet.somnia.network
