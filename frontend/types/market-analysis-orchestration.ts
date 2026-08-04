// types/market-analysis-orchestration.ts
// Sprint 15D.2 - Result contract for MarketAnalysisOrchestrationService.
// Sprint 15D.10 - Rewired: MarketAnalysisResult now carries the Sprint
// 15D.8/15D.9 outputs (ExplainableAnalysis, RiskProfile, ConfidenceProfile)
// instead of the older, narrower 15D.1 Confidence/Evidence shape - `summary`
// is Gemini's natural-language phrasing of `explainable`, never an
// independent analysis (see MarketAnalysisOrchestrationService.buildPrompt).
// Every real outcome is still distinguished explicitly - a failure is never
// represented as a successful analysis. "completed" is the only variant
// that carries a MarketAnalysisResult. "provider-error" is new: distinct
// from "provider-unavailable" (never configured/reachable), it represents a
// configured provider that was attempted and returned a typed error
// (rate-limit, auth, malformed response) - mirroring the same distinction
// MarketIntelligenceOutcome (Sprint 15D.8) already makes one layer down.
import type { MarketSymbol } from "./market";
import type { Intent } from "./intent";
import type { RiskProfile } from "./risk-intelligence";
import type { ConfidenceProfile } from "./confidence-intelligence";
import type { ExplainableAnalysis } from "./explainable-analysis";
import type { AnalysisRun } from "./analysis-run";
import type { MarketDataProviderError } from "@/lib/market-data/errors";

export interface MarketAnalysisRequest {
  userId: string;
  symbol: MarketSymbol;
  question: string;
}

export interface MarketAnalysisResult {
  symbol: MarketSymbol;
  intent: Intent;
  /** Gemini's natural-language phrasing of `explainable` - Gemini is instructed to restate this, never to perform new analysis. */
  summary: string;
  /** The deterministic, pre-computed analysis `summary` is required to restate - the single source of truth Gemini was given. */
  explainable: ExplainableAnalysis;
  risk: RiskProfile;
  confidence: ConfidenceProfile;
}

export type MarketAnalysisOutcome =
  | { status: "completed"; run: AnalysisRun; result: MarketAnalysisResult }
  // Sprint D2.3.S3 - `cause` retains the original typed MarketDataProviderError
  // from one layer down (MarketIntelligenceOutcome), when one exists, so the
  // route can build the same standardized error DTO
  // (lib/market-data/error-dto.ts) every other market-data-facing route
  // returns, instead of only a pre-formatted message string.
  | { status: "provider-unavailable"; run: AnalysisRun; reason: string; provider: string }
  | { status: "provider-error"; run: AnalysisRun; reason: string; provider: string; cause?: MarketDataProviderError }
  | { status: "invalid-request"; message: string }
  | { status: "ai-failed"; run: AnalysisRun; message: string };
