// types/intelligence-panel.ts
// Sprint D2.3 (Phase 6) - the AI Intelligence Panel's presentation DTO. Built
// ONCE, server-side, in services/ai/intelligence-panel.service.ts, from the
// existing CopilotAnalysis (services/ai/trading-copilot.service.ts) - the same
// D2.2 pipeline the Trading Copilot page already uses. This is a projection of
// already-computed real values, never a new analysis: no field here is
// calculated in this file or in any React component. A field the underlying
// engine did not (or could not) compute is left undefined - the UI renders
// "Not available" / "Insufficient data", never a guess.
import type { TrendDirection } from "./market";
import type { ConfidenceBand } from "./technical-context";

export type MarketStatusLabel = "bullish" | "bearish" | "neutral" | "transition" | "high_volatility" | "insufficient";
export type MomentumState = "strengthening" | "weakening" | "neutral";
export type RiskBand = "low" | "medium" | "high" | "insufficient";

export interface MarketStructureFields {
  trend?: TrendDirection;
  momentum?: MomentumState;
  /** Same ATR-derived band shown in Risk - repeated here as a structural field for the same real signal, not a second calculation. */
  volatility?: "low" | "medium" | "high";
  /** No volume-based liquidity classifier exists for FX/commodities/crypto in this codebase - always undefined. Never fabricated. */
  liquidity?: "low" | "medium" | "high";
  session: "open" | "closed" | "unknown";
  bias?: TrendDirection;
}

/**
 * Forward-compatible shape for price levels. Every value is undefined today:
 * no engine in this codebase computes support/resistance/invalidation/
 * breakout/pullback levels, and Sprint D2.2 (Phase 7) explicitly forbids
 * inventing them ("no synthetic trade setups, no invented support/
 * resistance"). The panel renders "Not available" per field rather than
 * hiding the section, so the gap is visible instead of silently dropped.
 */
export interface KeyLevels {
  resistance?: number;
  support?: number;
  invalidation?: number;
  breakout?: number;
  pullback?: number;
}

export interface IntelligencePanelData {
  symbol: string;
  timeframe: string;
  computedAt: string;
  dataFreshnessMs: number;
  marketStatus: MarketStatusLabel;
  confidence: { band: ConfidenceBand; percent: number };
  risk: { band: RiskBand; explanation: string };
  structure: MarketStructureFields;
  keyLevels: KeyLevels;
  /** Top evidence items only (already real, engine-produced observations) - never long-form paragraphs. */
  evidence: string[];
}
