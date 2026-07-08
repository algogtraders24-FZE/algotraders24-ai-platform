// services/ai/trading/trade-setup.service.ts
import type { TradeSetup } from "@/types/trade-setup";
import type { BiasDirection } from "@/types/market-bias";
import type { FeatureMeta } from "@/types/feature-meta";

export const tradeSetupMeta: FeatureMeta = {
  featureId: "trade-setup",
  requiredPlan: "pro",
  estimatedCost: 2,
  dailyUsageWeight: 2,
};

export function getSetup(price: number, direction: BiasDirection, confidence: number): TradeSetup {
  const step = price * 0.006;
  const isBull = direction === "bullish";
  const isBear = direction === "bearish";

  const entry = price;
  const stopLoss = isBull ? price - step * 1.5 : isBear ? price + step * 1.5 : price - step;
  const tp1 = isBull ? price + step * 2 : isBear ? price - step * 2 : price + step;
  const tp2 = isBull ? price + step * 3.5 : isBear ? price - step * 3.5 : price + step * 2;
  const riskReward = Math.abs((tp1 - entry) / (entry - stopLoss)) || 1.5;

  return {
    direction,
    entry: +entry.toFixed(2),
    stopLoss: +stopLoss.toFixed(2),
    takeProfit: [+tp1.toFixed(2), +tp2.toFixed(2)],
    riskReward: +riskReward.toFixed(2),
    confidence,
  };
}