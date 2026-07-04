// data/sentiment.ts
import type { Sentiment } from "@/types/sentiment";

export const sentiments: Sentiment[] = [
  { symbol: "EURUSD", label: "bullish", score: 62, confidence: 80, updatedAt: "2025-01-15T10:00:00Z" },
  { symbol: "BTCUSD", label: "bearish", score: -48, confidence: 67, updatedAt: "2025-01-15T10:00:00Z" },
  { symbol: "XAUUSD", label: "neutral", score: 8, confidence: 54, updatedAt: "2025-01-15T10:00:00Z" },
];