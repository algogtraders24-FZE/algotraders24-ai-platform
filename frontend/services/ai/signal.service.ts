// services/ai/signal.service.ts
// AI Signal Engine — signal service (mock only)

import type { Signal, SignalStatus } from "@/types/signal";
import type { MarketCategory } from "@/types/market";
import { signals } from "@/data/signals";

export function getSignals(): Signal[] {
  return signals;
}

export function getSignalById(id: string): Signal | undefined {
  return signals.find((s) => s.id === id);
}

export function getSignalsByCategory(category: MarketCategory): Signal[] {
  return signals.filter((s) => s.category === category);
}

export function getSignalsByStatus(status: SignalStatus): Signal[] {
  return signals.filter((s) => s.status === status);
}

export function getLatestSignals(limit = 10): Signal[] {
  return [...signals]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, limit);
}