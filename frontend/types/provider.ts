// types/provider.ts
import type { ProviderName } from "./provider-name";
import type { ProviderResponse, ProviderHealth } from "./provider-response";
import type { Message } from "./message";

export interface AIProvider {
  name: ProviderName;
  generate: (prompt: string) => Promise<ProviderResponse>;
  chat: (messages: Message[]) => Promise<ProviderResponse>;
  summarize: (text: string) => Promise<ProviderResponse>;
  analyze: (input: string) => Promise<ProviderResponse>;
  healthCheck: () => Promise<ProviderHealth>;
  stream: (prompt: string) => AsyncIterable<string>;
}

export class UnknownProviderError extends Error {
  constructor(name: string) {
    super(`Unknown AI provider: "${name}"`);
    this.name = "UnknownProviderError";
  }
}