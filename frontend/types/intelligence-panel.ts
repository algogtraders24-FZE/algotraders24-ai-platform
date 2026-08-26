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
import type { SmcLiquidityZones } from "@/lib/market-data/indicators";

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
 * Real price levels (Sprint D2.7.11 post-completion, 2026-08-25 - reverses
 * Sprint D2.2 Phase 7's original "no invented support/resistance" rule
 * with the user's own explicit sign-off, after an investigation confirmed
 * this specific gap was a genuinely unbuilt calculation, not a data-
 * provider limitation - see project_ai_intelligence_data_gaps_investigation
 * memory). Every value is a REAL derivation, never invented:
 * resistance/support are the real recent high/low over a real lookback
 * window (lib/market-data/indicators.ts's recentPriceRange/
 * keyPriceLevels - reused identically by both the CopilotAnalysis and
 * DecisionContext pipelines, so the two can never disagree for the same
 * symbol); pullback is the standard 61.8% Fibonacci retracement between
 * them; invalidation/breakout are only derived when a real directional
 * bias exists (the nearest opposing/matching level - see each
 * pipeline's own deriveKeyLevels()). A field still renders "Not
 * available" whenever there genuinely isn't enough data (too few
 * candles, or no directional bias) - never a fabricated value.
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
  /**
   * Post-completion addition (2026-08-26) - real SMC (Smart Money
   * Concepts) Equal High/Equal Low liquidity zones, a price-action proxy
   * (NOT genuine order-book depth, which still doesn't exist anywhere in
   * this platform - see MarketStructureFields.liquidity above, which
   * remains correctly "Not available" for that unrelated, volume-based
   * concept). Computed by lib/market-data/indicators.ts's
   * liquidityZones(), directly ported from the user's own tested
   * ea-research/G01_LiquiditySweep_MSS_FVG EA. Only wired through the
   * DecisionContext/Workspace pipeline today - the legacy CopilotAnalysis
   * pipeline (Trading Copilot) honestly supplies {} (not computed there),
   * same "undefined where genuinely not computed" rule as every other
   * field on this DTO.
   */
  liquidityZones: SmcLiquidityZones;
  /** Top evidence items only (already real, engine-produced observations) - never long-form paragraphs. */
  evidence: string[];
}
