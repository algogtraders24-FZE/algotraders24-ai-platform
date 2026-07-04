// data/trend.ts
import type { Trend } from "@/types/trend";

export const trends: Trend[] = [
  { symbol: "EURUSD", direction: "bullish", strength: 78, timeframe: "1h", updatedAt: "2025-01-15T10:00:00Z" },
  { symbol: "BTCUSD", direction: "bearish", strength: 64, timeframe: "4h", updatedAt: "2025-01-15T10:00:00Z" },
  { symbol: "XAUUSD", direction: "neutral", strength: 45, timeframe: "1d", updatedAt: "2025-01-15T10:00:00Z" },
];