// services/intelligence/chat/intelligence-panel-projection.service.ts
// Sprint D2.8.16 - a real, live-reproduced bug: the Workspace page showed
// TWO intelligence panels for the same symbol at the same moment that
// flatly disagreed (the D2.3 "AI Intelligence" hero panel, sourced from
// the legacy CopilotAnalysis/indicator-completeness pipeline via
// services/ai/intelligence-panel.service.ts, vs. the D2.6.11 "Research"
// panel below it, sourced from the real D2.5.x/D2.8.x DecisionContext
// engine) - one showed "Bullish, 100% confidence, RSI 64.1 computed", the
// other showed "Insufficient Data, 31/100, RSI14 could not be computed",
// for the same instrument at the same time. Confirmed live via an
// authenticated production walkthrough, not a hypothesis.
//
// This is the SAME projection concern services/ai/intelligence-panel.service.ts
// already solved (CopilotAnalysis -> IntelligencePanelData), just retargeted
// at the canonical, already-unified source the Research panel itself uses
// (VerifiedAnswerResponse, D2.6.10) instead of a second, disconnected
// analysis. No new indicator/regime/score computation happens here - every
// field is a direct read or a simple relabeling of an already-computed real
// value, matching this codebase's "a field the engine did not produce
// renders 'Not available'/'Insufficient data', never a guess" rule.
//
// Deliberately scoped to the Workspace page only (where the two panels sat
// on one screen and the contradiction was most severe) - Trading Copilot
// and Market Intelligence remain separate, clearly-labeled tools with their
// own distinct scope (raw indicator confidence vs. full evidence-based
// analysis), not touched by this projection.
import type { VerifiedAnswerResponse } from "@/types/verified-answer-response";
import type { IntelligencePanelData, KeyLevels, MarketStatusLabel, MarketStructureFields } from "@/types/intelligence-panel";
import type { ConfidenceBand } from "@/types/technical-context";
import type { TrendDirection } from "@/types/market";
import { keyPriceLevels } from "@/lib/market-data/indicators";

const MAX_EVIDENCE_ITEMS = 4;

// A regime/decisionState honestly means "insufficient" before any directional
// reading is attempted - mirrors RegimeService's own "insufficient-data" being
// checked first in every regime consumer across this codebase.
function deriveMarketStatus(va: VerifiedAnswerResponse): MarketStatusLabel {
  if (va.decisionState === "insufficient-intelligence" || va.marketContext.regimeType === "insufficient-data") {
    return "insufficient";
  }
  if (va.marketContext.regimeType === "high-volatility") return "high_volatility";
  if (va.marketContext.regimeType === "transition") return "transition";
  if (va.marketContext.regimeType === "trending-bullish" || va.marketContext.regimeType === "breakout") return "bullish";
  if (va.marketContext.regimeType === "trending-bearish" || va.marketContext.regimeType === "breakdown") return "bearish";
  // ranging / low-volatility / low-liquidity (structurally unreachable, D2.5.2)
  return "neutral";
}

function trendDirectionFromCurrentState(trend?: "up" | "down" | "sideways"): TrendDirection | undefined {
  if (trend === "up") return "bullish";
  if (trend === "down") return "bearish";
  if (trend === "sideways") return "neutral";
  return undefined;
}

// Sprint D2.7.11 (post-completion) - real Key Levels, sourced from
// DecisionCurrentState.recentRange (D2.5.x, already computed by
// market-state.service.ts's own computeRecentRange - a real 20-bar
// high/low, never recomputed here) via the SAME keyPriceLevels()/
// pullback-ratio math services/ai/intelligence-panel.service.ts's legacy
// CopilotAnalysis pipeline uses - one shared derivation, never two that
// could disagree for the same symbol (the exact class of bug this file's
// own header comment already documents once happening). Invalidation/
// breakout stay undefined without a real directional bias, same
// reasoning as the legacy pipeline's own deriveKeyLevels().
function deriveKeyLevels(recentRange: VerifiedAnswerResponse["currentState"]["recentRange"], bias?: TrendDirection): KeyLevels {
  const { resistance, support, pullback } = keyPriceLevels(recentRange);
  let invalidation: number | undefined;
  let breakout: number | undefined;
  if (bias === "bullish") {
    invalidation = support;
    breakout = resistance;
  } else if (bias === "bearish") {
    invalidation = resistance;
    breakout = support;
  }
  return { resistance, support, pullback, invalidation, breakout };
}

// D2.5.5's own documented ceiling constant (CEILING_INSUFFICIENT_REGIME = 40)
// is reused as the low/medium boundary rather than an invented threshold -
// see types/intelligence-score.ts. 70 is a plain, commonly-used
// medium/high split with no deeper claim than "clearly more complete than
// not". This bands intelligence-QUALITY, never trade confidence - the
// Intelligence Score's own non-negotiable meaning (types/intelligence-score.ts).
function confidenceBandFromScore(overallScore: number | undefined): ConfidenceBand {
  if (overallScore === undefined) return "insufficient";
  if (overallScore < 40) return "low";
  if (overallScore < 70) return "medium";
  return "high";
}

function riskBandFromLevel(level: "low" | "medium" | "high" | undefined): IntelligencePanelData["risk"]["band"] {
  return level ?? "insufficient";
}

export function buildIntelligencePanelDataFromVerifiedAnswer(va: VerifiedAnswerResponse): IntelligencePanelData {
  const trend = trendDirectionFromCurrentState(va.currentState.trendDirection);

  // D2.5.x's DecisionCurrentState has no MACD-histogram-equivalent momentum
  // signal (see the type's own header) - honestly left undefined rather than
  // fabricating one, exactly like this file's structure.liquidity below.
  const structure: MarketStructureFields = {
    trend,
    momentum: undefined,
    volatility: va.currentState.volatilityBand,
    liquidity: undefined,
    // D2.5.x's DecisionCurrentState carries no market-hours/session field
    // (unlike the legacy CopilotAnalysis snapshot) - "unknown" is the honest
    // reading, not a guess in either direction.
    session: "unknown",
    bias: trend,
  };

  const overallScore = va.intelligenceScore.overallScore;
  const dataFreshnessMs = Math.max(0, Date.now() - new Date(va.generatedAt).getTime());

  return {
    symbol: va.marketContext.symbol,
    timeframe: va.marketContext.timeframe,
    computedAt: va.generatedAt,
    dataFreshnessMs,
    marketStatus: deriveMarketStatus(va),
    confidence: { band: confidenceBandFromScore(overallScore), percent: overallScore ?? 0 },
    risk: { band: riskBandFromLevel(va.riskContext.overallLevel), explanation: va.riskContext.basis.join(" ") },
    structure,
    keyLevels: deriveKeyLevels(va.currentState.recentRange, trend),
    // Post-completion addition (2026-08-26) - direct passthrough of
    // DecisionCurrentState.liquidityZones (D2.5.x/D2.6.x's own real SMC
    // Equal High/Low computation) - never recomputed here.
    liquidityZones: va.currentState.liquidityZones ?? {},
    evidence: va.supportingEvidence.slice(0, MAX_EVIDENCE_ITEMS).map((item) => item.claim),
  };
}
