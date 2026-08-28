/**
 * Vendored from DreamDEX Bot Kit (`packages/ec-core/src/index.ts`), MIT.
 * Copyright (c) 2026 DreamDEX S.A. See ../VENDORED.md and ../LICENSE.dreamdex.
 *
 * Trimmed to the READ path: Fathom is read-only through Stage 5, so the write
 * modules (orders / settlement / claim / inventory) are deliberately absent.
 */

export { createExchange, shutdown, assertTxOk, type EcContext } from "./exchange.js";
export {
  loadConfig,
  envNum,
  loadEnv,
  makeChain,
  type EcConfig,
  type EcAddresses,
  type Network,
  type PriceFeedConfig,
} from "./config.js";
export { DEPLOYMENTS, type NetworkDeployment, type Address } from "./addresses.js";
export {
  activeMarkets,
  marketOnchain,
  inVenue,
  resolveVenue,
  venueOf,
  operatorOf,
  outcomeSymbols,
  isTradable,
  snapshot,
  settledMarkets,
  explainEmptyScope,
  toRawUnits,
  quantize,
  MARKET_STATUS,
  type EcSnapshot,
  type VenueScope,
} from "./markets.js";
export {
  assertProbability,
  clampProbability,
  assertTradable,
  noPrice,
} from "./gotchas.js";

// Re-export the SDK's converters + core types so callers have one import surface.
export {
  probabilityToPrice,
  priceToProbability,
  fromHuman,
  toHuman,
  type SomniaMarkets,
  type UnifiedMarket,
  type UnifiedOrder,
  type UnifiedOrderBook,
  type UnifiedPrice,
  type MarketOnchain,
} from "@somnia-chain/markets-sdk";
