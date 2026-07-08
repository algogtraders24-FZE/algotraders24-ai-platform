// types/trade-setup.ts
import type { BiasDirection } from "./market-bias";

export interface TradeSetup {
  direction: BiasDirection;
  entry: number;
  stopLoss: number;
  takeProfit: number[];
  riskReward: number;
  confidence: number; // 0–100
}