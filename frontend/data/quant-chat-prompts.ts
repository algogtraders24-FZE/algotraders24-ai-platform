// data/quant-chat-prompts.ts
// QP-2 - Conversational Strategy Builder's own suggestion set, passed to
// the existing PromptSuggestions component via its new optional
// `suggestions` prop. Kept separate from data/mock-prompts.ts (the
// K-series assistant's own list) - a different domain, never mixed.
import type { PromptSuggestion } from "@/types/prompt";

export const quantChatPromptSuggestions: PromptSuggestion[] = [
  { id: "qc-sug-1", label: "EMA crossover", prompt: "Build a strategy on XAUUSD 1H that buys when EMA(9) crosses above EMA(21), with a fixed 2% equity risk per trade and a stop-loss at 1.5x ATR(14)." },
  { id: "qc-sug-2", label: "RSI reversal", prompt: "Build a strategy on EURUSD 15m that buys when RSI(14) is below 30 and sells when RSI(14) is above 70, with a fixed quantity of 1 unit per trade." },
];
