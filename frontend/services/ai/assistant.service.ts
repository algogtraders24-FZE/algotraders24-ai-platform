// services/ai/assistant.service.ts
import type { AssistantRequest, AssistantResponse } from "@/types/assistant";
import type { Message } from "@/types/message";
import { orchestrate } from "./ai-orchestrator.service";
import { buildSystemPrompt } from "./prompts/system-prompt.service";

export function createUserMessage(content: string): Message {
  return { id: `m-${Date.now()}`, role: "user", content, createdAt: new Date().toISOString() };
}

export async function sendMessage(req: AssistantRequest): Promise<AssistantResponse> {
 return orchestrate({ ...req });
}