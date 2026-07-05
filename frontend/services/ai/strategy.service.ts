// services/ai/strategy.service.ts
import type { Strategy } from "@/types/strategy";
import { mockStrategies } from "@/data/mock-strategies";

export function getStrategies(): Strategy[] {
  return mockStrategies;
}

export function getStrategyById(id: string): Strategy | undefined {
  return mockStrategies.find((s) => s.id === id);
}