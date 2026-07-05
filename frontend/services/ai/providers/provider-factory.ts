// services/ai/providers/provider-factory.ts
import type { AIProvider } from "@/types/provider";
import type { ProviderName } from "@/types/provider-name";
import { UnknownProviderError } from "@/types/provider";
import { providerRegistry } from "./provider-registry";

export const DEFAULT_PROVIDER: ProviderName = "mock";

export function getProvider(name: ProviderName = DEFAULT_PROVIDER): AIProvider {
  const provider = providerRegistry[name];
  if (!provider) throw new UnknownProviderError(name);
  return provider;
}