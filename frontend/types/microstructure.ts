// types/microstructure.ts
// Sprint D2.8.5 - Microstructure Intelligence Foundation. The provider-
// neutral raw-evidence + deterministic-derivation contract for market
// microstructure (bid/ask, order-book depth, trade/aggressor data),
// deliberately separate from the existing types/market-snapshot.ts -
// MarketSnapshot is the OHLC/quote model every existing consumer already
// depends on and this sprint must not redesign it. This is a NEW,
// additive, standalone contract with no dependency from
// services/intelligence/** in either direction (see the D2.8.5 spec doc's
// "Intelligence Integration Boundary" section) - MarketState, Regime,
// Hypothesis, DecisionContext, and IntelligenceScore all continue to
// operate exactly as before, whether or not microstructure evidence
// exists for a symbol.
//
// Every field uses MicrostructureField<T> instead of a bare optional
// value, because a bare `undefined` can only mean one thing ("not known")
// while this domain genuinely needs to distinguish five different reasons
// a value isn't a real number - see CapabilityState below. This is a
// deliberately richer honesty contract than MarketSnapshot's own
// "optional field = provider didn't report it" convention, because
// microstructure fields can be invalid (crossed market, negative
// quantity) or structurally not_supported_by_provider (a provider that
// never has an order-book concept) in ways a quote field cannot.
import type { MarketSymbol, MarketCategory } from "./market";
import type { FreshnessStatus } from "./provider-reliability";

export const MICROSTRUCTURE_CONTRACT_VERSION = "1.0.0";

/**
 * - "available": a real value exists, actually reported/derived from real evidence.
 * - "unavailable": the provider or upstream call did not supply the raw evidence needed - never silently 0/empty.
 * - "not_supported_by_provider": this provider's API has no concept of this field at all (a structural, permanent gap, not a transient failure).
 * - "stale": a real value exists but its underlying evidence failed the freshness check - the value is still carried (never discarded), just flagged.
 * - "invalid": raw evidence existed but failed structural validation (non-finite, negative quantity, crossed market, malformed level) - rejected, never "fixed" by guessing.
 *
 * `value` is present only when state is "available" or "stale" - every
 * other state means there is genuinely nothing trustworthy to read.
 */
export type CapabilityState = "available" | "unavailable" | "not_supported_by_provider" | "stale" | "invalid";

export interface MicrostructureField<T> {
  state: CapabilityState;
  value?: T;
  /** Required for every state except "available" - explains WHY, never a bare unexplained gap. */
  reason?: string;
}

export interface MicrostructureOrderBookLevel {
  price: number;
  quantity: number;
}

/**
 * One real trade/print. `aggressorSide` is its own MicrostructureField
 * because a provider may report trades without reporting which side
 * initiated them (Binance does; most providers researched in D2.8.2/
 * D2.8.4 do not) - a trade with unavailable aggressorSide still
 * contributes to raw trade evidence, just never to buyVolume/sellVolume.
 */
export interface MicrostructureTrade {
  price: number;
  quantity: number;
  timestamp: string;
  aggressorSide: MicrostructureField<"buy" | "sell">;
}

/** Raw evidence only - nothing in this interface is ever computed, only reported or honestly marked absent. */
export interface RawMicrostructureEvidence {
  bid: MicrostructureField<number>;
  ask: MicrostructureField<number>;
  bidLevels: MicrostructureField<MicrostructureOrderBookLevel[]>;
  askLevels: MicrostructureField<MicrostructureOrderBookLevel[]>;
  trades: MicrostructureField<MicrostructureTrade[]>;
  /** Provider-native sequence/update identifier (e.g. Binance's lastUpdateId), kept as a string since providers use incompatible numeric ranges/formats - never used across providers, only within one provider's own stream to detect gaps. */
  sequenceId: MicrostructureField<string>;
}

/** Every field here is a pure, deterministic function of RawMicrostructureEvidence - see services/microstructure/microstructure-calculation.service.ts. Never independently sourced from a provider. */
export interface DerivedMicrostructure {
  midPrice: MicrostructureField<number>;
  spread: MicrostructureField<number>;
  bidDepth: MicrostructureField<number>;
  askDepth: MicrostructureField<number>;
  depthImbalance: MicrostructureField<number>;
  buyVolume: MicrostructureField<number>;
  sellVolume: MicrostructureField<number>;
  volumeDelta: MicrostructureField<number>;
  liquidityConcentration: MicrostructureField<number>;
}

/** The provider adapter's raw output before validation/derivation - see types/microstructure-provider.ts. */
export interface RawMicrostructureResult {
  symbol: MarketSymbol;
  provider: string;
  assetClass: MarketCategory;
  /** The provider's own reading time when known, else the adapter's retrievedAt - same "source timestamp" convention as MarketSnapshot.timestamp. */
  timestamp: string;
  retrievedAt: string;
  evidence: RawMicrostructureEvidence;
}

/**
 * Snapshot-level freshness is FreshnessStatus (reused verbatim from
 * services/market-data/freshness-policy.service.ts - never a competing
 * system) plus one additional state this domain needs that quote/candle
 * freshness never did: "invalid", for a timestamp that is malformed or
 * impossibly in the future - a structural defect, not merely "old".
 */
export type MicrostructureFreshnessStatus = FreshnessStatus | "invalid";

/** The complete, provider-neutral, ready-to-consume microstructure snapshot. Future Intelligence consumers read ONLY this shape - never a raw provider payload. */
export interface MicrostructureSnapshot {
  symbol: MarketSymbol;
  provider: string;
  assetClass: MarketCategory;
  timestamp: string;
  retrievedAt: string;
  freshnessStatus: MicrostructureFreshnessStatus;
  evidence: RawMicrostructureEvidence;
  derived: DerivedMicrostructure;
  generatedAt: string;
  version: string;
}
