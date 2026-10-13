// services/ai/ai-resilience.ts
// Resilience around the one AI call that writes the market brief: a transient
// provider failure ("This model is currently experiencing high demand", 429, a
// network blip) is retried once and then handed to a secondary provider when one
// is configured, and a failure that still gets through is reported in plain words
// instead of the provider's raw JSON. Pure: the provider calls and the sleep are
// injected, so it is fully testable.

import { AIProviderError } from "@/lib/ai/errors";

const TRANSIENT_TEXT = /\b(503|429|502|504|overloaded|high demand|temporar(y|ily)|unavailable|try again|timed? ?out|rate.?limit)\b/i;

export function isTransientAiError(error: unknown): boolean {
  if (error instanceof AIProviderError) {
    if (error.kind === "rate_limit" || error.kind === "network" || error.kind === "timeout") return true;
    return TRANSIENT_TEXT.test(error.message);
  }
  return error instanceof Error && TRANSIENT_TEXT.test(error.message);
}

export const AI_BUSY_MESSAGE = "The AI service is busy right now, so the written summary could not be produced. Please try again in a minute.";

/** What the user sees for a failed AI call: plain words for a transient failure, the typed message otherwise (never a raw provider JSON blob). */
export function friendlyAiMessage(error: unknown): string {
  if (isTransientAiError(error)) return AI_BUSY_MESSAGE;
  if (error instanceof AIProviderError) {
    const m = error.message.trim();
    return m.startsWith("{") ? "The AI analysis could not be completed." : m;
  }
  return "The AI analysis could not be completed.";
}

export interface ResilienceDeps<T> {
  primary: () => Promise<T>;
  /** A different provider, or null when none is configured. */
  fallback: (() => Promise<T>) | null;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
}

/** primary -> (transient failure) retry once -> (transient again) fallback provider -> throw. A non-transient error is thrown immediately. */
export async function completeWithResilience<T>(deps: ResilienceDeps<T>): Promise<T> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    return await deps.primary();
  } catch (first) {
    if (!isTransientAiError(first)) throw first;
    await sleep(deps.retryDelayMs ?? 1500);
    try {
      return await deps.primary();
    } catch (second) {
      if (!isTransientAiError(second) || !deps.fallback) throw second;
      return await deps.fallback();
    }
  }
}
