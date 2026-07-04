// types/signal.ts
// AI Signal Engine — core signal types

import type { MarketCategory, MarketSymbol } from "./market";
import type { RiskLevel } from "./risk";

export type SignalDirection = "BUY" | "SELL" | "WAIT";

export type SignalStatus =
  | "active"
  | "pending"
  | "closed"
  | "expired"
  | "cancelled";

export type SignalTimeframe =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1d"
  | "1w";

/** Confidence score is a normalized 0–100 value produced by the engine. */
export type ConfidenceScore = number;

export interface SignalTargets {
  entry: number;
  stopLoss: number;
  takeProfit: number[];
}

export interface Signal {
  id: string;
  symbol: MarketSymbol;
  category: MarketCategory;
  direction: SignalDirection;
  timeframe: SignalTimeframe;
  confidence: ConfidenceScore;
  riskLevel: RiskLevel;
  status: SignalStatus;
  targets: SignalTargets;
  rationale: string;
  createdAt: string;
  expiresAt: string;
  source: "ai-engine";
}

export interface SignalResult {
  signalId: string;
  outcome: "win" | "loss" | "breakeven" | "open";
  pnlPercent: number;
  closedAt: string | null;
}