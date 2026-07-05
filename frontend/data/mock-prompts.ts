// data/mock-prompts.ts
import type { PromptTemplate, PromptSuggestion } from "@/types/prompt";

export const promptTemplates: PromptTemplate[] = [
  {
    id: "tpl-analyze",
    label: "Analyze market",
    template: "Analyze {{symbol}}\nTimeframe: {{timeframe}}\nStrategy: {{strategy}}\nRisk: {{risk}}",
    variables: ["symbol", "timeframe", "strategy", "risk"],
  },
  {
    id: "tpl-strategy",
    label: "Build strategy",
    template: "Build a {{strategy}} strategy for {{symbol}} on {{timeframe}}.",
    variables: ["strategy", "symbol", "timeframe"],
  },
];

export const promptSuggestions: PromptSuggestion[] = [
  { id: "sug-1", label: "Analyze Gold", prompt: "Analyze XAUUSD on the 1H timeframe." },
  { id: "sug-2", label: "Analyze EURUSD", prompt: "Analyze EURUSD and give a bias." },
  { id: "sug-3", label: "Smart Money Concepts", prompt: "Explain Smart Money Concepts." },
  { id: "sug-4", label: "Order Blocks", prompt: "Explain Order Blocks with an example." },
  { id: "sug-5", label: "Gold Scalping", prompt: "Build a Gold scalping strategy." },
  { id: "sug-6", label: "Risk Management", prompt: "Give me risk management advice." },
];