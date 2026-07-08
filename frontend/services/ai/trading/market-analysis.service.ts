// services/ai/trading/market-analysis.service.ts
import type { MarketAnalysis, MarketQuote } from "@/types/market-analysis";
import type { FeatureMeta } from "@/types/feature-meta";
import { getIndicators } from "./technical-analysis.service";
import { getLevels } from "./support-resistance.service";
import { getLiquidity } from "./liquidity-analysis.service";
import { getBias } from "./market-bias.service";
import { getSetup } from "./trade-setup.service";
import { getRisk } from "./risk-engine.service";
import { getConfidence } from "./confidence-engine.service";

export const marketAnalysisMeta: FeatureMeta = {
  featureId: "market-analysis",
  requiredPlan: "free",
  estimatedCost: 3,
  dailyUsageWeight: 3,
};

export function analyzeMarket(quote: MarketQuote): MarketAnalysis {
  const indicators = getIndicators(quote.price);
  const levels = getLevels(quote.price);
  const liquidity = getLiquidity(quote.price);
  const bias = getBias(quote.changePercent, indicators.trendStrength);
  const setup = getSetup(quote.price, bias.direction, bias.confidence);
  const confidence = getConfidence(bias.confidence, indicators.trendStrength, setup.riskReward);
  const risk = getRisk(setup.riskReward, confidence);

  const warnings: string[] = [];
  if (bias.direction === "neutral") warnings.push("No clear directional bias — consider waiting.");
  if (setup.riskReward < 1.5) warnings.push("Risk/reward below 1.5 — setup quality is limited.");
  if (indicators.rsi > 70) warnings.push("RSI overbought.");
  if (indicators.rsi < 30) warnings.push("RSI oversold.");

  const nextActions = [
    "Confirm setup on a lower timeframe.",
    "Wait for price to reach the entry zone.",
    "Set alerts at key support/resistance levels.",
  ];

  return {
    quote,
    bias,
    indicators,
    levels,
    liquidity,
    risk,
    setup,
    confidence,
    reasoning: `${quote.name} is ${bias.direction}. ${bias.reasoning} Trend strength ${indicators.trendStrength}/100 with a ${setup.riskReward} R:R setup.`,
    warnings,
    nextActions,
  };
}