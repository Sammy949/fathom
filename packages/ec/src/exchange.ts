/**
 * @license
 * Copyright DreamDEX S.A.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/LICENSE
 */

// The single entry point every example uses. Builds ONE `SomniaMarkets` exchange
// (signer optional) from your .env + the bundled deployment addresses, and hands
// back the exchange plus the resolved config.
//
// After this you trade by SYMBOL in human units — no raw prices, no token
// threading, no escrow math. The raw tiers stay reachable at `exchange.client`
// (bigint reads) and `exchange.trader` (bigint writes) for the few things the
// unified verbs don't cover (on-chain status, faucet, outcome balances).

import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { loadConfig, loadEnv, makeChain, type EcConfig } from "./config.js";

export interface EcContext {
  exchange: SomniaMarkets;
  config: EcConfig;
  /** True when a signer (PRIVATE_KEY) is loaded — required for writes. */
  canTrade: boolean;
}

/**
 * Build the exchange. Pass `{ withSigner: true }` to require a PRIVATE_KEY for
 * writes (createOrder / mintSet / redeem …); read-only bots omit it and never
 * open a signer. You still call `exchange.loadMarkets()` yourself.
 */
export function createExchange(opts: { withSigner?: boolean } = {}): EcContext {
  loadEnv();
  const config = loadConfig();

  if (opts.withSigner && !config.privateKey) {
    throw new Error(
      "PRIVATE_KEY is required for trading. Set it in .env (a funded key that DIFFERS " +
        "from any quoter's — self-matching is blocked), or run a read-only example.",
    );
  }

  const exchange = new SomniaMarkets({
    indexerUrl: config.indexerUrl,
    chain: makeChain(config),
    wsRpcUrl: config.wsRpcUrl,
    addresses: config.addresses,
    // Underlying-asset price feed (BTC/ETH spot + EMA mark). Required by
    // exchange.fetchPrice / watchPrice; every other verb ignores it.
    priceFeed: config.priceFeed,
    // Only opened for writes. Signs locally with fixed fees + a tracked nonce,
    // confirming in one round-trip via realtime_sendRawTransaction.
    privateKey: opts.withSigner ? config.privateKey : undefined,
  });

  return { exchange, config, canTrade: Boolean(config.privateKey) };
}

/**
 * Throw if a trader write's receipt says the transaction REVERTED.
 *
 * The SDK signs with fixed fees and skips gas estimation/simulation, so a
 * reverting transaction is not caught before send — and the write helpers
 * resolve with `{ hash, receipt }` WITHOUT checking `receipt.status`. A mint on
 * a Locked market, a redeem before resolution, etc. all "succeed" silently
 * unless you check. Wrap every state-changing call whose failure you care about.
 */
export function assertTxOk(res: { hash?: string; receipt?: { status?: string } }, label = "transaction"): void {
  if (res?.receipt?.status === "reverted") {
    throw new Error(`${label} REVERTED on-chain (tx ${res.hash ?? "?"}) — the SDK does not throw on a reverted receipt; check market status / balances and retry deliberately.`);
  }
}

/**
 * Close the exchange without letting a one-shot script hang. The live-tail
 * socket can keep the event loop alive past `close()`, so this caps the wait and
 * moves on; pair it with `process.exit(0)` at the end of a script.
 */
export async function shutdown(ctx: EcContext, timeoutMs = 3_000): Promise<void> {
  await Promise.race([
    Promise.resolve(ctx.exchange.close()).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
