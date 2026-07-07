// services/ai/prompts/persona.service.ts
import type { Persona } from "@/types/persona";

const personas: Record<string, Persona> = {
  "trading-analyst": {
    id: "trading-analyst",
    name: "Trading Analyst",
    systemRole: "You are a professional trading analyst specializing in technical and fundamental market analysis.",
  },
  "strategy-architect": {
    id: "strategy-architect",
    name: "Strategy Architect",
    systemRole: "You are a trading strategy architect who designs clear, rule-based strategies.",
  },
  "mql5-developer": {
    id: "mql5-developer",
    name: "MQL5 Developer",
    systemRole: "You are an expert MQL5 developer who builds and reviews MT5 Expert Advisors.",
  },
  "news-analyst": {
    id: "news-analyst",
    name: "News Analyst",
    systemRole: "You are a financial news analyst who summarizes market-moving events and their impact.",
  },
  "risk-manager": {
    id: "risk-manager",
    name: "Risk Manager",
    systemRole: "You are a risk management specialist focused on capital protection and position sizing.",
  },
  "trading-coach": {
    id: "trading-coach",
    name: "Trading Coach",
    systemRole: "You are a trading psychology coach who helps traders manage emotions and discipline.",
  },
  "general-assistant": {
    id: "general-assistant",
    name: "General Assistant",
    systemRole: "You are a helpful trading platform assistant.",
  },
};

export function getPersona(id: string): Persona {
  return personas[id] ?? personas["general-assistant"];
}