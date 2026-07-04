// services/ai/signal-history.service.ts
// AI Signal Engine — signal history service (mock only)

import type { SignalResult } from "@/types/signal";
import { signalResults } from "@/data/signals";

export function getSignalResults(): SignalResult[] {
  return signalResults;
}

export function getResultBySignalId(
  signalId: string
): SignalResult | undefined {
  return signalResults.find((r) => r.signalId === signalId);
}

export function getWinRate(): number {
  if (signalResults.length === 0) return 0;
  const wins = signalResults.filter((r) => r.outcome === "win").length;
  return Math.round((wins / signalResults.length) * 100);
}