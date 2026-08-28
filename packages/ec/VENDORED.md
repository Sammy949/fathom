# Vendored from DreamDEX Bot Kit

These files are copied, largely verbatim, from
[`somnia-chain/dreamdex-bot-kit`](https://github.com/somnia-chain/dreamdex-bot-kit)
(`packages/ec-core/src/`), MIT licensed — see `LICENSE.dreamdex`.
Vendored at upstream commit `dccd2fd`, 2026-08-28.

Copyright (c) 2026 DreamDEX S.A.

## Why vendored rather than depended on

`@dreamdex-bot-kit/ec-core` is `private: true` and unpublished, and its `main` field points at
raw `.ts` that only resolves inside the Bot Kit's own npm workspace. A `file:` dependency on it
cannot build on Vercel. It is MIT, so copying is permitted, and Fathom needs to extend the
market layer with its own risk fields regardless.

## What we took, and what we left

Taken (the read path — everything needed to discover markets and read state):

| File | Role |
|---|---|
| `addresses.ts` | Per-network deployed contract addresses. Verified on-chain 2026-08-28. |
| `config.ts` | `.env` → `EcConfig`; network endpoints, venue scope, tick/lot grid. |
| `exchange.ts` | Builds the one `SomniaMarkets` instance. Signer optional. |
| `markets.ts` | Venue scoping, active-market discovery, on-chain snapshots, `quantize`. |
| `gotchas.ts` | Cheap assertions encoding the venue's footguns. |

Deliberately **not** taken:

- `orders.ts`, `settlement.ts`, `claim.ts`, `inventory.ts` — the write path. Fathom is read-only
  through Stage 5; pulling these in now would be dead code carrying live footguns. Revisit at
  Stage 6, where `placeLimit` is the piece worth having (it converts prices in tick/lot integer
  units through the raw trader tier, dodging the float→`InvalidPrice` bug, and checks the wallet
  before signing).

## Local modifications

None yet. Keep it that way where possible — an unmodified copy is trivial to diff against
upstream. Anything Fathom-specific belongs in `packages/core/`, not here. If a file does need
editing, mark the change with a `// FATHOM:` comment so the diff is greppable.

## Upstream facts worth not rediscovering

- Venue ids **move** (three times in the first week of August 2026). `VENUE_ID` is required or
  `activeMarkets` throws rather than silently trading the wrong venue.
- `decimals` is **6 on testnet** (tUSDC) and **18 on mainnet** (USDso). The 18-decimal path is
  where float prices break; testnet will never show you that bug.
- Binary market rows carry **no** `tickSize` / `lotSize` / `minQuantity` — unlike spot. They come
  from config (`MM_TICK` / `MM_LOT`), not discovery.
- `loadMarkets()` skips finalized binaries, so it cannot find settled markets or unclaimed
  winnings. Use `listBinaryMarkets({ status: "Finalized" })`.
