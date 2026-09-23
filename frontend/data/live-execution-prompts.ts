// data/live-execution-prompts.ts
// Live Execution (Paper) - quick-start suggestions, deliberately DIFFERENT
// wording from data/quant-chat-prompts.ts's own two suggestions: those use
// percent-equity-risk sizing and an ATR-multiple stop-loss, neither of
// which services/algo-test/live-execution/live-execution.service.ts
// supports yet (it only enforces fixed-quantity sizing and fixed-
// distance/fixed-price/risk-multiple stops/targets - real, disclosed
// Phase 1 gaps, not an oversight). Reusing the Quant Chat prompts here
// would compile successfully but then silently "skip" every tick with an
// unsupported-sizing/stop message - a confusing quick-start experience.
// These two are written to always compile into a fully-supported shape.
import type { PromptSuggestion } from "@/types/prompt";

export const liveExecutionPromptSuggestions: PromptSuggestion[] = [
  {
    id: "live-exec-sug-1",
    label: "EMA crossover",
    prompt: "Buy XAUUSD on the 1H when EMA(9) crosses above EMA(21), and sell when EMA(9) crosses below EMA(21). Fixed quantity of 1 unit per trade, stop-loss 5 price units, take-profit 2R.",
  },
  {
    id: "live-exec-sug-2",
    label: "RSI reversal",
    prompt: "Buy EURUSD on 15m when RSI(14) is below 30, and sell when RSI(14) is above 70. Fixed quantity of 1 unit per trade, stop-loss 0.002 price units, take-profit 1R.",
  },
];
