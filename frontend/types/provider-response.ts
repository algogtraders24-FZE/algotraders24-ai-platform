// types/provider-response.ts
import type { ProviderName } from "./provider-name";

export interface ProviderResponse {
  provider: ProviderName;
  content: string;
  implemented: boolean;
}

export interface ProviderHealth {
  provider: ProviderName;
  healthy: boolean;
  message: string;
}