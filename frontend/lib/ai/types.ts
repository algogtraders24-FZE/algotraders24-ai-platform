// lib/ai/types.ts
// SOLID: ISP - narrow, role-specific interfaces. No provider imports here.
export type AIRole = "system" | "user" | "assistant";

export interface AIMessage {
  role: AIRole;
  content: string;
}

export interface AICompletionRequest {
  messages: AIMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AICompletionResponse {
  content: string;
  model: string;
  provider: string;
  // Requirement #8: expose usage + latency through the service layer.
  // Optional so existing PlaceholderProvider stays valid (no breaking change).
  usage?: { promptTokens: number; completionTokens: number };
  latencyMs?: number;
}

export type AIProviderName =
  | "gemini"
  | "openai"
  | "claude"
  | "deepseek"
  | "placeholder";
