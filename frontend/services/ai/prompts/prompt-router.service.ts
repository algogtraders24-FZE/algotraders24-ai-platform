// services/ai/prompts/prompt-router.service.ts
import type { Intent } from "@/types/intent";

interface Route {
  personaId: string;
  templateId: string;
  schemaId: string;
}

const routes: Record<Intent, Route> = {
  "market-analysis": { personaId: "trading-analyst", templateId: "trading-analysis", schemaId: "market-analysis" },
  "news-analysis": { personaId: "news-analyst", templateId: "market-news", schemaId: "general-output" },
  "strategy-generation": { personaId: "strategy-architect", templateId: "strategy-builder", schemaId: "strategy-output" },
  "ea-generation": { personaId: "mql5-developer", templateId: "mql5-generator", schemaId: "ea-output" },
  "risk-analysis": { personaId: "risk-manager", templateId: "risk-analysis", schemaId: "general-output" },
  "portfolio-analysis": { personaId: "risk-manager", templateId: "portfolio-analysis", schemaId: "general-output" },
  "trading-education": { personaId: "trading-analyst", templateId: "general-chat", schemaId: "general-output" },
  "trading-psychology": { personaId: "trading-coach", templateId: "trading-psychology", schemaId: "general-output" },
  "general-chat": { personaId: "general-assistant", templateId: "general-chat", schemaId: "general-output" },
};

export function routeIntent(intent: Intent): Route {
  return routes[intent];
}