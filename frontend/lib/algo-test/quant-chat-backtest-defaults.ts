// lib/algo-test/quant-chat-backtest-defaults.ts
// QP-4 - Quant Chat -> Run Backtest. Locked decision 4a: no new date-range/
// initial-balance UI in this sprint - reuse the SAME defaults
// AlgoTestPanel.tsx's own AI-mode form already uses (DEFAULT_INITIAL_BALANCE
// = 10_000, a 7-day lookback window). AlgoTestPanel's own isoDateNDaysAgo/
// toEngineTimestamp helpers are private, unexported module-level functions
// there - not modifying that file just to export them (out of QP-4's
// locked scope), so this is a small, deliberate re-statement of the exact
// same date-math, not a new convention. The server-side, timeframe-aware
// range cap (algoTestService's own maxRangeDaysFor()) remains the real
// authority - this module only ever proposes a REQUEST, it never itself
// validates or enforces the cap.
import type { AiCompileAndRunRequest } from "@/types/algo-test";

export const QUANT_CHAT_BACKTEST_DEFAULT_INITIAL_BALANCE = 10_000;
export const QUANT_CHAT_BACKTEST_DEFAULT_LOOKBACK_DAYS = 7;

function isoDateNDaysAgo(n: number, now: Date): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function toEngineTimestamp(dateOnly: string, endOfDay: boolean): string {
  return `${dateOnly}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

/**
 * Builds the exact request compileAndRunAiStrategy() (the locked canonical
 * execution path) needs, from the current accumulated Quant Chat intent -
 * never a stale compiledSpec, matching the locked "current-intent" rule.
 * `now` is injectable only for deterministic tests; production callers
 * omit it.
 */
export function buildQuantChatBacktestRequest(intent: string, now: Date = new Date()): AiCompileAndRunRequest {
  const startDate = isoDateNDaysAgo(QUANT_CHAT_BACKTEST_DEFAULT_LOOKBACK_DAYS, now);
  const endDate = isoDateNDaysAgo(1, now);
  return {
    intent,
    startTime: toEngineTimestamp(startDate, false),
    endTime: toEngineTimestamp(endDate, true),
    initialBalance: QUANT_CHAT_BACKTEST_DEFAULT_INITIAL_BALANCE,
  };
}
