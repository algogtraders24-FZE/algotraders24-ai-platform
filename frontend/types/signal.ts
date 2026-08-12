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

// Sprint D2.7.2 - the runtime companion to the SignalTimeframe union, added
// here (not re-declared per caller) so every future consumer that needs to
// validate a request-supplied timeframe string - the new native chart
// engine's candles route being the first - shares one list, never a second
// timeframe registry. Order matches the union above (fastest to slowest).
export const SIGNAL_TIMEFRAMES: readonly SignalTimeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

export function isSignalTimeframe(value: unknown): value is SignalTimeframe {
  return typeof value === "string" && (SIGNAL_TIMEFRAMES as readonly string[]).includes(value);
}

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