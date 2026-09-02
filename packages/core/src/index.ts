/**
 * Fathom core — Stage 2 ingestion.
 *
 * Everything downstream (dashboard, risk engine, agent) reads `MarketSnapshot`
 * and nothing else. Nothing past this package talks to the indexer, the SDK or
 * the chain directly.
 */

export {
  query,
  queryOrNull,
  IndexerUnavailable,
  IndexerRejected,
  DEFAULT_RETRY,
  type RetryPolicy,
} from "./indexer";

export {
  withRetry,
  isTransient,
  DEFAULT_SDK_RETRY,
  type SdkRetryPolicy,
} from "./resilient";

export {
  liveMarkets,
  liveVenues,
  marketById,
  candles,
  fills,
  oracleQuestion,
  type MarketRow,
  type CandleRow,
  type FillRow,
  type OracleQuestionRow,
} from "./queries";

export {
  bookMetrics,
  executableShares,
  DEFAULT_NEAR_BAND,
  type BookMetrics,
  type BookSide,
} from "./book";

export {
  toPricePoints,
  moveMetrics,
  flowMetrics,
  freshness,
  MIN_SAMPLES_FOR_MOVE,
  type PricePoint,
  type MoveMetrics,
  type FlowMetrics,
  type Freshness,
} from "./history";

export {
  MARKET_STATUS,
  statusName,
  oracleExplorerUrl,
  resolutionState,
  isGradeable,
  degradedFields,
  ok,
  degraded,
  absent,
  type MarketSnapshot,
  type MarketIdentity,
  type OnchainState,
  type ResolutionState,
  type Provenance,
  type Sourced,
  type MarketStatusName,
} from "./snapshot";

export {
  publicClient,
  poolParams,
  marketChainState,
  restingOrders,
  restingBook,
  binaryPoolAbi,
  binaryMarketAbi,
  type PoolParams,
  type MarketChainState,
  type RestingOrder,
} from "./chain";

export {
  ingestVenue,
  snapshotMarket,
  candleIntervalFor,
  type IngestOptions,
  type IngestResult,
} from "./ingest";

export {
  gradeSnapshot,
  assess,
  liquiditySignal,
  volatilitySignal,
  stalenessSignal,
  windowSignal,
  manipulationSignal,
  resolutionSignal,
  venueSignal,
  THRESHOLDS,
  DREAMDEX_VENUE_ID,
  type Assessment,
  type Signal,
  type SignalId,
  type Severity,
  type Verdict,
  type RuleHit,
} from "./risk";

export {
  explainAssessment,
  fallbackExplanation,
  guardExplanation,
  buildTrace,
  type Explanation,
  type ExplainOptions,
  type GuardFailure,
  type DecisionTrace,
} from "./explain";

export {
  resolveProvider,
  callProvider,
  describeProvider,
  GROQ_DEFAULT_MODEL,
  GROQ_BASE_URL,
  type ProviderConfig,
  type ProviderKind,
  type ProviderRequest,
  type ProviderResult,
} from "./provider";
