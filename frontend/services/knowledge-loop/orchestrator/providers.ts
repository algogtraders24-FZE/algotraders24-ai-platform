// services/knowledge-loop/orchestrator/providers.ts
// Sprint K3-B-2 — AT24 AI Assistant Knowledge Loop: the K3 provider chain.
//
// Contract: AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §7.1 — Claude → Gemini →
// OpenAI → deterministic. Each slot wraps the existing, generic `lib/ai`
// `AIProvider` (K1_DECISION SO-1: REST, no SDK). Only the Claude slot carries
// Anthropic's native web_search server tool (K3-B-1's additive `req.tools`).
// Gemini/OpenAI answer plainly — a degraded-but-truthful fallback when Claude
// is down (the market-intel path's own Gemini+googleSearch grounding is a
// separate concern and is NOT reused here in K3-B v1).
//
// NOTE: this file is dynamically imported by the orchestrator factory so a
// client bundle never pulls a provider; and `@google/genai` / provider
// constructors (which throw on a missing key) are only touched inside
// `generate()` / behind an `isAvailable()` gate.

import { KNOWLEDGE_ANSWER_CONFIG } from "@/config/knowledge-loop.config";
import type { AIProvider } from "@/lib/ai/provider.interface";
import type { AICompletionRequest, AIMessage } from "@/lib/ai/types";
import type { AnswerProviderSlot, AnswerGenInput, AnswerGenResult } from "./ports";

const C = KNOWLEDGE_ANSWER_CONFIG;

function hasEnv(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

// K3-C C7 — knowledge-block injection hardening (contract §6.1 / §12.7).
// Retrieved knowledge is EVIDENCE, never authority over the orchestration,
// tool, or security contract. It is wrapped in a fixed delimiter the system
// instruction (§6.1) explicitly tells the model to treat as reference data,
// never as instructions. Pre-K4 this content is admin-authored; once K4
// starts capturing candidate-derived knowledge, retrieved text is no longer
// fully trusted, so this hardening lands now rather than later.
const KNOWLEDGE_TAG_OPEN = "<at24_knowledge>";
const KNOWLEDGE_TAG_CLOSE = "</at24_knowledge>";

/** Neutralise any literal `<at24_knowledge>` / `</at24_knowledge>` substring
 *  that appears INSIDE retrieved content, so a chunk can never prematurely
 *  "close" the trusted wrapper and have its own text read as free-standing
 *  instructions outside the tag. Ordinary content is returned byte-identical
 *  (no false-positive mangling). */
export function escapeKnowledgeBlock(text: string): string {
  return text.replace(/<\/?at24_knowledge>/gi, (m) =>
    m.replace("<", "&lt;").replace(">", "&gt;"),
  );
}

/** assemble the `AIMessage[]` every slot sends (identical across providers). */
export function buildMessages(input: AnswerGenInput): AIMessage[] {
  const msgs: AIMessage[] = [{ role: "system", content: input.system }];
  for (const h of input.history) {
    msgs.push({ role: h.role, content: h.content });
  }
  const userParts: string[] = [];
  const knowledgeBlock = input.knowledgeBlock.trim();
  if (knowledgeBlock.length > 0) {
    userParts.push(
      `${KNOWLEDGE_TAG_OPEN}\n${escapeKnowledgeBlock(knowledgeBlock)}\n${KNOWLEDGE_TAG_CLOSE}`,
    );
  }
  userParts.push(`User question: ${input.userMessage}`);
  msgs.push({ role: "user", content: userParts.join("\n\n") });
  return msgs;
}

/** a slot backed by a generic AIProvider. Claude → tools; others → plain. */
export class ProviderSlot implements AnswerProviderSlot {
  constructor(
    readonly name: string,
    private readonly envKey: string,
    private readonly make: () => AIProvider,
    readonly supportsWebSearch: boolean,
  ) {}

  isAvailable(): boolean {
    return hasEnv(this.envKey);
  }

  async generate(input: AnswerGenInput): Promise<AnswerGenResult> {
    const provider = this.make();
    const req: AICompletionRequest = {
      messages: buildMessages(input),
      maxTokens: C.ANSWER_MAX_TOKENS,
      ...(this.supportsWebSearch && input.webSearchEnabled
        ? { tools: [{ kind: "web_search", maxUses: C.WEB_SEARCH_MAX_USES }] }
        : {}),
      // Additive, ClaudeProvider-only (AICompletionRequest.images's own doc
      // comment) - every other slot's provider silently ignores it.
      ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
    };
    const res = await provider.complete(req);
    const webSources = res.webSources ?? [];
    const searchCount = res.searchCount ?? 0;
    return {
      text: res.content,
      webSources,
      searchCount,
      webSearchUsed: searchCount > 0 && webSources.length > 0,
      webSearchUnavailable: res.webSearchUnavailable === true,
      // K3-C C1 fields — pass through verbatim; only ClaudeProvider sets them,
      // every other provider's AICompletionResponse leaves them undefined.
      webSearchFailed: res.webSearchFailed === true,
      webSearchPartialFailure: res.webSearchPartialFailure === true,
      continuationCount: res.continuationCount ?? 0,
      continuationBudgetExhausted: res.continuationBudgetExhausted === true,
      truncated: res.truncated === true,
      stopReason: res.stopReason,
      // K3-C C8 — cost-relevant usage, where the provider reports it.
      usage: res.usage,
    };
  }
}

/** Default production chain (K3_PREFLIGHT §4 / contract §7.1). Lazily builds
 *  providers; a missing key short-circuits at `isAvailable()`. */
export async function defaultAnswerSlots(): Promise<AnswerProviderSlot[]> {
  const { ClaudeProvider, GeminiProvider, OpenAIProvider } = await import("@/lib/ai");
  return [
    new ProviderSlot("claude", "ANTHROPIC_API_KEY", () => new ClaudeProvider(), true),
    new ProviderSlot("gemini", "GEMINI_API_KEY", () => new GeminiProvider(), false),
    new ProviderSlot("openai", "OPENAI_API_KEY", () => new OpenAIProvider(), false),
  ];
}
