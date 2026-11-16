// services/arena-fx/ai-client.ts
// One call to the Anthropic Messages API for an AI contestant (REST, no SDK, like lib/ai/providers/claude.provider.ts). Server only.
// No temperature is sent (newer models reject it). The key is read from the environment and never logged or returned.
import "server-only";

export interface AiCallResult {
  ok: boolean;
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  error?: string;
}

const TIMEOUT_MS = 45_000;

export async function callClaude(model: string, system: string, user: string, maxTokens = 1800): Promise<AiCallResult> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { ok: false, text: "", inputTokens: null, outputTokens: null, error: "ANTHROPIC_API_KEY is not set" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, text: "", inputTokens: null, outputTokens: null, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    return { ok: text.length > 0, text, inputTokens: body.usage?.input_tokens ?? null, outputTokens: body.usage?.output_tokens ?? null, error: text.length > 0 ? undefined : "empty answer" };
  } catch (error) {
    return { ok: false, text: "", inputTokens: null, outputTokens: null, error: error instanceof Error ? error.name : "error" };
  }
}
