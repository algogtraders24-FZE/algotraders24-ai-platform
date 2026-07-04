// data/signals.ts
// AI Signal Engine — mock signals

import type { Signal, SignalResult } from "@/types/signal";

export const signals: Signal[] = [
  {
    id: "sig-001",
    symbol: "EURUSD",
    category: "forex",
    direction: "BUY",
    timeframe: "1h",
    confidence: 82,
    riskLevel: "low",
    status: "active",
    targets: { entry: 1.0842, stopLoss: 1.0810, takeProfit: [1.0880, 1.0910] },
    rationale: "Bullish trend continuation with strong momentum.",
    createdAt: "2025-01-15T09:30:00Z",
    expiresAt: "2025-01-15T13:30:00Z",
    source: "ai-engine",
  },
  {
    id: "sig-002",
    symbol: "BTCUSD",
    category: "crypto",
    direction: "SELL",
    timeframe: "4h",
    confidence: 67,
    riskLevel: "high",
    status: "active",
    targets: { entry: 94250, stopLoss: 96000, takeProfit: [91500, 89000] },
    rationale: "Overbought conditions near resistance zone.",
    createdAt: "2025-01-15T08:00:00Z",
    expiresAt: "2025-01-16T00:00:00Z",
    source: "ai-engine",
  },
  {
    id: "sig-003",
    symbol: "XAUUSD",
    category: "commodities",
    direction: "WAIT",
    timeframe: "1d",
    confidence: 54,
    riskLevel: "medium",
    status: "pending",
    targets: { entry: 2685, stopLoss: 2660, takeProfit: [2710] },
    rationale: "Consolidation phase; awaiting breakout confirmation.",
    createdAt: "2025-01-15T07:00:00Z",
    expiresAt: "2025-01-16T07:00:00Z",
    source: "ai-engine",
  },
  {
    id: "sig-004",
    symbol: "AAPL",
    category: "stocks",
    direction: "BUY",
    timeframe: "1d",
    confidence: 74,
    riskLevel: "medium",
    status: "closed",
    targets: { entry: 226.5, stopLoss: 222, takeProfit: [230, 234] },
    rationale: "Breakout above key resistance on volume.",
    createdAt: "2025-01-14T14:00:00Z",
    expiresAt: "2025-01-15T14:00:00Z",
    source: "ai-engine",
  },
];

export const signalResults: SignalResult[] = [
  { signalId: "sig-004", outcome: "win", pnlPercent: 1.45, closedAt: "2025-01-15T13:00:00Z" },
];