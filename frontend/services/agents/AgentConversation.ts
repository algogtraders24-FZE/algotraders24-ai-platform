// services/agents/AgentConversation.ts
// Conversation interface for agents. Wraps the existing assistant service so
// an agent can answer in its persona voice, using the current Gemini provider.

import type { Agent } from "@/types/agent";
import { getAgent } from "./AgentManager";
import { sendMessage } from "@/services/ai/assistant.service";

export async function talkToAgent(agentId: string, message: string): Promise<string> {
  const agent: Agent | undefined = getAgent(agentId);
  if (!agent) return "Agent not found.";

  const framed = `You are the ${agent.name} agent. Goal: ${agent.goal}. Respond in that role.\n\n${message}`;
  const res = await sendMessage({ conversationId: `agent-${agentId}`, message: framed });
  return res.message.content;
}