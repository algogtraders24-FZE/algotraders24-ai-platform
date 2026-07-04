// config/signal.config.ts
// AI Signal Engine — configuration

import type { MarketCategory } from "@/types/market";
import type { SignalDirection, SignalTimeframe } from "@/types/signal";
import type { RiskLevel } from "@/types/risk";

export const SUPPORTED_MARKETS: MarketCategory[] = [
  "forex",
  "crypto",
  "indices",
  "stocks",
  "commodities",
];

export const SIGNAL_TYPES: SignalDirection[] = ["BUY", "SELL", "WAIT"];

export const RISK_LEVELS: RiskLevel[] = ["low", "medium", "high"];

export const TIMEFRAMES: SignalTimeframe[] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
];

export const CONFIDENCE_THRESHOLDS = {
  low: 50,
  medium: 70,
  high: 85,
} as const;

export const SIGNAL_ENGINE = {
  version: "1.0.0-foundation",
  source: "ai-engine",
  maxActiveSignals: 50,
} as const;