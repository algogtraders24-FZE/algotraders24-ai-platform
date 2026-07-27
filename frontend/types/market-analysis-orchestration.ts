// types/market-analysis-orchestration.ts
// Sprint 15D.2 - Result contract for MarketAnalysisOrchestrationService.
// Every real outcome is distinguished explicitly - a failure is never
// represented as a successful analysis. "completed" is the only variant
// that carries a MarketAnalysisResult.
import type { MarketSymbol } from "./market";
import type { Intent } from "./intent";
import type { Evidence, Confidence } from "./market-context";
import type { AnalysisRun } from "./analysis-run";

export interface MarketAnalysisRequest {
  userId: string;
  symbol: MarketSymbol;
  question: string;
}

export interface MarketAnalysisResult {
  symbol: MarketSymbol;
  intent: Intent;
  summary: string;
  confidence: Confidence;
  evidence: Evidence[];
}

export type MarketAnalysisOutcome =
  | { status: "completed"; run: AnalysisRun; result: MarketAnalysisResult }
  | { status: "provider-unavailable"; run: AnalysisRun; reason: string }
  | { status: "invalid-request"; message: string }
  | { status: "ai-failed"; run: AnalysisRun; message: string };
