// services/ai/ai-orchestrator.service.ts
import type { AssistantRequest, AssistantResponse, AIProvider } from "@/types/assistant";
import type { Message } from "@/types/message";
import { getTemplateById, buildPrompt } from "./prompt.service";
import { mockResponses, DEFAULT_RESPONSE } from "@/data/mock-conversations";

/** Mock provider — swap for OpenAI/Claude/Gemini later without touching UI. */
const mockProvider: AIProvider = {
  name: "mock",
  generate: async (prompt: string): Promise<string> => {
    const lower = prompt.toLowerCase();
    const match = mockResponses.find((r) => r.keywords.some((k) => lower.includes(k)));
    return match ? match.response : DEFAULT_RESPONSE;
  },
};

export async function orchestrate(req: AssistantRequest): Promise<AssistantResponse> {
  let prompt = req.message;
  let usedTemplateId: string | null = null;

  if (req.templateId && req.variables) {
    const tpl = getTemplateById(req.templateId);
    if (tpl) {
      prompt = buildPrompt(tpl.template, req.variables);
      usedTemplateId = tpl.id;
    }
  }

  const content = await mockProvider.generate(prompt);

  const message: Message = {
    id: `m-${Date.now()}`,
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  };

  return { message, usedTemplateId };
}