// services/ai/prompts/response-schema.service.ts
import type { ResponseSchema } from "@/types/response-schema";

const schemas: Record<string, ResponseSchema> = {
  "market-analysis": {
    id: "market-analysis",
    label: "Market Analysis",
    sections: ["Market Bias", "Confidence", "Trend", "Liquidity", "Entry", "Stop Loss", "Take Profit", "Risk/Reward", "Reasoning", "News Impact", "Warnings"],
  },
  "strategy-output": {
    id: "strategy-output",
    label: "Strategy",
    sections: ["Strategy Name", "Market", "Timeframe", "Entry Rules", "Exit Rules", "Risk Rules", "Advantages", "Disadvantages"],
  },
  "ea-output": {
    id: "ea-output",
    label: "EA",
    sections: ["Architecture", "Indicators", "Entry Logic", "Exit Logic", "Money Management", "Risk Management", "Optimization"],
  },
  "general-output": {
    id: "general-output",
    label: "General",
    sections: ["Answer", "Reasoning", "Risk Note"],
  },
};

export function getSchema(id: string): ResponseSchema {
  return schemas[id] ?? schemas["general-output"];
}