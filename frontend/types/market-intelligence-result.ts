// types/market-intelligence-result.ts
// Sprint 15D.8 - Result contract for MarketIntelligencePipelineService.
// Pure orchestration envelope: this file defines no new domain logic, only
// the shape that carries the unmodified Sprint 15D.4-15D.7 engine outputs
// (EvidenceBundle, ReasoningResult, RiskProfile, ConfidenceProfile) plus
// pipeline-level metadata.
//
// Naming note: types/market-intelligence.ts already exports an unrelated,
// pre-existing `MarketIntelligence` interface (a mock-data-backed
// dashboard summary type - overallScore/trendStrength/sentimentScore,
// served by services/ai/market-intelligence.service.ts from
// data/market-intelligence.ts). This file is deliberately named
// differently (market-intelligence-**result**.ts) and does not extend,
// replace, wrap, or otherwise interact with that legacy type or service -
// same disambiguation discipline as every prior 15D sprint.
//
// Every real outcome is distinguished explicitly - a failure is never
// represented as a completed result. Only the "completed" variant carries
// a MarketIntelligenceResult, and that result is deep-frozen by
// MarketIntelligencePipelineService before being returned (requirement:
// immutable output).
import type { MarketSymbol } from "./market";
import type { EvidenceBundle } from "./evidence";
import type { ReasoningResult } from "./reasoning";
import type { RiskProfile } from "./risk-intelligence";
import type { ConfidenceProfile } from "./confidence-intelligence";
import type { MarketDataProviderError } from "@/lib/market-data/errors";

export interface MarketIntelligenceRequest {
  symbol: MarketSymbol;
  /** ISO timestamp: request context "as of" this time. Providers may ignore this - mirrors MarketContextRequest. */
  asOf?: string;
}

export type MarketIntelligenceProviderStatus =
  | { status: "ok"; provider: string }
  | { status: "unavailable"; provider: string; reason: string }
  | { status: "error"; provider: string; reason: string };

export interface MarketIntelligenceMetadata {
  /** Identifies this pipeline's stage composition - bumped only when the orchestration itself changes, not when an individual engine changes internally. */
  pipelineVersion: string;
  providerStatus: MarketIntelligenceProviderStatus;
  /** Wall-clock duration of this pipeline run in milliseconds, measured via the injected Clock - never a raw Date.now() read by a consumer. */
  executionTimeMs: number;
  /** The single timestamp threaded through every stage (evidence, reasoning, risk, confidence) - taken from the provider's own retrievedAt, never a separately-read clock value that could drift from the data's actual freshness. */
  generatedAt: string;
}

/** Immutable: deep-frozen by MarketIntelligencePipelineService.run() before being returned. */
export interface MarketIntelligenceResult {
  symbol: MarketSymbol;
  evidence: EvidenceBundle;
  reasoning: ReasoningResult;
  risk: RiskProfile;
  confidence: ConfidenceProfile;
  metadata: MarketIntelligenceMetadata;
}

export type MarketIntelligenceOutcome =
  | { status: "completed"; result: MarketIntelligenceResult }
  | { status: "provider-unavailable"; symbol: MarketSymbol; provider: string; reason: string }
  // Sprint D2.3.S3 - `cause` retains the original typed MarketDataProviderError
  // (when one exists - the "no provider injected" branch has none) so the
  // route layer can build the same standardized error DTO
  // (lib/market-data/error-dto.ts) every other market-data-facing route
  // returns, instead of only having a pre-formatted message string.
  | { status: "provider-error"; symbol: MarketSymbol; provider: string; reason: string; cause?: MarketDataProviderError };
