// services/ai/risk.service.ts
// AI Signal Engine — risk service (mock only)

import type { RiskLevel, RiskScore } from "@/types/risk";
import type { Signal } from "@/types/signal";

const RISK_MAP: Record<RiskLevel, RiskScore> = {
  low: { level: "low", score: 25, volatility: 20, exposurePercent: 1 },
  medium: { level: "medium", score: 55, volatility: 50, exposurePercent: 2 },
  high: { level: "high", score: 85, volatility: 80, exposurePercent: 3 },
};

export function getRiskScore(level: RiskLevel): RiskScore {
  return RISK_MAP[level];
}

export function getSignalRisk(signal: Signal): RiskScore {
  return RISK_MAP[signal.riskLevel];
}