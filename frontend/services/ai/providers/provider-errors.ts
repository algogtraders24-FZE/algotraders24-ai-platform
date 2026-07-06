// services/ai/providers/provider-errors.ts
export type ProviderErrorKind =
  | "invalid-key"
  | "rate-limit"
  | "timeout"
  | "network"
  | "invalid-response"
  | "unknown";

export function classifyError(err: unknown): { kind: ProviderErrorKind; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("api key") || lower.includes("api_key") || lower.includes("401") || lower.includes("permission"))
    return { kind: "invalid-key", message: "Invalid or missing API key." };
  if (lower.includes("429") || lower.includes("rate") || lower.includes("quota"))
    return { kind: "rate-limit", message: "Rate limit reached. Try again shortly." };
  if (lower.includes("timeout") || lower.includes("aborted"))
    return { kind: "timeout", message: "Request timed out." };
  if (lower.includes("network") || lower.includes("fetch failed") || lower.includes("enotfound"))
    return { kind: "network", message: "Network error reaching the provider." };

  return { kind: "unknown", message: msg || "Unknown provider error." };
}