// lib/ai/provider.interface.ts
// SOLID: OCP/LSP - every provider is substitutable behind this contract.
// Streaming & tool-calling intentionally omitted (added later, no break).
import type {
  AICompletionRequest,
  AICompletionResponse,
  AIProviderName,
} from "./types";

export interface AIProvider {
  readonly name: AIProviderName;
  complete(req: AICompletionRequest): Promise<AICompletionResponse>;
}
