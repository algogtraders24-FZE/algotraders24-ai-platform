// data/mock-strategies.ts
import type { Strategy } from "@/types/strategy";

export const mockStrategies: Strategy[] = [
  {
    id: "strat-gold-scalp",
    name: "Gold Scalping",
    category: "commodities",
    timeframe: "5m",
    risk: "high",
    description: "Fast intraday scalps on XAUUSD around liquidity sweeps.",
    rules: [
      "Trade London & NY sessions only.",
      "Enter on order block retest after liquidity grab.",
      "Fixed 1:1.5 risk-reward, 10-pip stop.",
    ],
  },
  {
    id: "strat-eurusd-swing",
    name: "EURUSD Swing",
    category: "forex",
    timeframe: "4h",
    risk: "medium",
    description: "Trend-following swings using EMA structure and SMC.",
    rules: [
      "Trade in direction of 4H trend.",
      "Enter on H1 order block.",
      "Risk 1% per trade.",
    ],
  },
];