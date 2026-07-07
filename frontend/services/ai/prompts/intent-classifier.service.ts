// services/ai/prompts/intent-classifier.service.ts
import type { Intent } from "@/types/intent";

const rules: { intent: Intent; keywords: string[] }[] = [
  { intent: "ea-generation", keywords: ["ea", "expert advisor", "mql5", "mt5 code", "generate ea"] },
  { intent: "strategy-generation", keywords: ["strategy", "build a", "scalping", "swing", "system"] },
  { intent: "news-analysis", keywords: ["news", "headline", "economic", "calendar", "cpi", "fed"] },
  { intent: "risk-analysis", keywords: ["risk", "position size", "drawdown", "stop loss", "lot size"] },
  { intent: "portfolio-analysis", keywords: ["portfolio", "diversif", "allocation"] },
  { intent: "trading-psychology", keywords: ["psychology", "emotion", "discipline", "fear", "greed"] },
  { intent: "trading-education", keywords: ["explain", "what is", "how does", "smart money", "order block", "liquidity", "ict"] },
  { intent: "market-analysis", keywords: ["analyze", "analysis", "gold", "xauusd", "eurusd", "btc", "bias", "trend"] },
];

export function classifyIntent(input: string): Intent {
  const lower = input.toLowerCase();
  for (const r of rules) {
    if (r.keywords.some((k) => lower.includes(k))) return r.intent;
  }
  return "general-chat";
}