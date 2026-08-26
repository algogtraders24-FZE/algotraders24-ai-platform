// services/ai/intelligence-panel.service.ts
// Sprint D2.3 (Phase 6) - pure, one-shot projection from the existing
// CopilotAnalysis (services/ai/trading-copilot.service.ts, itself unmodified)
// into the AI Intelligence Panel's presentation DTO. This is the ONLY place
// that derives the panel's labels (trend/momentum/bias/market status) - it
// reads only already-computed real indicator values (EMA/MACD/ATR from the
// D2.2 indicator engine) and classifies them; it never computes a new
// indicator and never invents a value the engine did not produce. Called once
// per request from the API route - React only renders the result.
import type { CopilotAnalysis } from "./trading-copilot.service";
import type { IntelligencePanelData, KeyLevels, MarketStatusLabel, MarketStructureFields, MomentumState } from "@/types/intelligence-panel";
import type { KeyPriceLevels } from "@/lib/market-data/indicators";
import type { TrendDirection } from "@/types/market";

const MAX_EVIDENCE_ITEMS = 4;

function deriveTrend(ema20?: number, ema50?: number): TrendDirection | undefined {
  if (ema20 === undefined || ema50 === undefined) return undefined;
  if (ema20 > ema50) return "bullish";
  if (ema20 < ema50) return "bearish";
  return "neutral";
}

function deriveMomentum(histogram?: number): MomentumState | undefined {
  if (histogram === undefined) return undefined;
  if (histogram > 0) return "strengthening";
  if (histogram < 0) return "weakening";
  return "neutral";
}

function conflicts(trend?: TrendDirection, momentum?: MomentumState): boolean {
  if (!trend || !momentum) return false;
  return (trend === "bullish" && momentum === "weakening") || (trend === "bearish" && momentum === "strengthening");
}

function deriveBias(trend?: TrendDirection, momentum?: MomentumState): TrendDirection | undefined {
  if (!trend) return undefined;
  if (trend === "neutral") return "neutral";
  if (!momentum) return trend;
  return conflicts(trend, momentum) ? "neutral" : trend;
}

// Sprint D2.7.11 (post-completion) - invalidation/breakout are only
// meaningful with a real directional bias: with no bias (neutral or
// undefined) there is no structure to invalidate or break out of, so
// both stay honestly undefined rather than guessing a direction. A
// bullish bias' invalidation is the nearest real support (a close below
// it invalidates the bullish read); its breakout is the nearest real
// resistance (clearing it confirms continuation) - mirrored for bearish.
function deriveKeyLevels(levels: KeyPriceLevels, bias?: TrendDirection): KeyLevels {
  const { resistance, support, pullback } = levels;
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

function deriveMarketStatus(
  hasSufficientData: boolean,
  riskVolatility: "low" | "medium" | "high" | undefined,
  trend?: TrendDirection,
  momentum?: MomentumState,
): MarketStatusLabel {
  if (!hasSufficientData) return "insufficient";
  if (riskVolatility === "high") return "high_volatility";
  if (!trend) return "insufficient";
  if (trend === "neutral") return "neutral";
  return conflicts(trend, momentum) ? "transition" : trend;
}

export function buildIntelligencePanelData(analysis: CopilotAnalysis): IntelligencePanelData {
  const { technical, risk, confidence, snapshot } = analysis;
  const ind = technical.indicators;

  const trend = deriveTrend(ind.ema20, ind.ema50);
  const momentum = deriveMomentum(ind.macd?.histogram);
  const bias = deriveBias(trend, momentum);
  const marketStatus = deriveMarketStatus(technical.hasSufficientData, risk.volatility, trend, momentum);

  const structure: MarketStructureFields = {
    trend,
    momentum,
    volatility: risk.volatility,
    liquidity: undefined,
    session: snapshot.marketStatus,
    bias,
  };

  const percent = confidence.total > 0 ? Math.round((confidence.computed / confidence.total) * 100) : 0;
  const dataFreshnessMs = Math.max(0, Date.now() - new Date(technical.computedAt).getTime());

  return {
    symbol: analysis.symbol,
    timeframe: technical.interval,
    computedAt: technical.computedAt,
    dataFreshnessMs,
    marketStatus,
    confidence: { band: confidence.band, percent },
    risk: { band: risk.volatility ?? "insufficient", explanation: risk.notes.join(" ") },
    structure,
    keyLevels: deriveKeyLevels(technical.keyLevels, bias),
    // Post-completion addition (2026-08-26) - SMC Equal High/Low liquidity
    // zones are only computed by the DecisionContext pipeline today (they
    // need MarketState.structure, which TechnicalContext doesn't carry) -
    // honestly {} here, never fabricated, matching this DTO's own rule.
    liquidityZones: {},
    evidence: technical.observations.slice(0, MAX_EVIDENCE_ITEMS),
  };
}
