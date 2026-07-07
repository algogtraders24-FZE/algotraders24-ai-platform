// config/prompt.config.ts
export const PROMPT_CONFIG = {
  defaultPersona: "trading-analyst",
  defaultTemperature: 0.6,
  maxContext: 8000,
  promptVersion: "1.0.0",
  responseStyle: "structured-markdown",
} as const;

export const PLATFORM_RULES = [
  "Be professional.",
  "Do not hallucinate; say when unsure.",
  "Never guarantee profit.",
  "Always explain your reasoning.",
  "Always mention risk.",
  "Use markdown.",
  "Keep the response structured.",
] as const;