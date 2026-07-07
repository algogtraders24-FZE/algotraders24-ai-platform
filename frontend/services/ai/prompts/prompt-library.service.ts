// services/ai/prompts/prompt-library.service.ts
const templates: Record<string, string> = {
  "trading-analysis": "Analyze the market the user asks about. Cover trend, key levels, liquidity, and bias.",
  "gold-analysis": "Analyze XAUUSD (Gold). Cover trend, key levels, liquidity zones, and directional bias.",
  "forex-analysis": "Analyze the requested forex pair. Cover trend, structure, key levels, and bias.",
  "crypto-analysis": "Analyze the requested crypto asset. Cover trend, volatility, key levels, and bias.",
  "strategy-builder": "Build a clear rule-based trading strategy for the user's request.",
  "risk-analysis": "Assess the risk of the described setup. Cover exposure, sizing, and drawdown.",
  "market-news": "Summarize the requested market news and its likely impact.",
  "economic-calendar": "Explain the relevant economic events and their market impact.",
  "portfolio-analysis": "Analyze the described portfolio for diversification and risk balance.",
  "trade-journal": "Review the user's trade journal entry and give constructive feedback.",
  "mql5-review": "Review the provided MQL5 Expert Advisor code for correctness and improvements.",
  "mql5-generator": "Generate MQL5 Expert Advisor logic for the user's described strategy.",
  "trading-psychology": "Give trading psychology guidance for the user's situation.",
  "general-chat": "Respond helpfully to the user's trading-related question.",
};

export function getTemplate(id: string): string {
  return templates[id] ?? templates["general-chat"];
}