// services/ai/ai-orchestrator.service.ts
import type { AssistantRequest, AssistantResponse } from "@/types/assistant";
import type { Message } from "@/types/message";
import type { ProviderName } from "@/types/provider-name";
import { getTemplateById, buildPrompt } from "./prompt.service";
import { getProvider, DEFAULT_PROVIDER } from "./providers/provider-factory";

export async function orchestrate(
  req: AssistantRequest,
  providerName: ProviderName = DEFAULT_PROVIDER
): Promise<AssistantResponse> {
  let prompt = req.message;
  let usedTemplateId: string | null = null;

  if (req.templateId && req.variables) {
    const tpl = getTemplateById(req.templateId);
    if (tpl) {
      prompt = buildPrompt(tpl.template, req.variables);
      usedTemplateId = tpl.id;
    }
  }

  const provider = getProvider(providerName);
  const result = await provider.generate(prompt);

  const message: Message = {
    id: `m-${Date.now()}`,
    role: "assistant",
    content: result.content,
    createdAt: new Date().toISOString(),
  };

  return { message, usedTemplateId };
}