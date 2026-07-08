// services/automation/AutomationRegistry.ts
// Central registry of automation actions. Workflows reference these by actionId.

import type { AutomationAction } from "@/types/automation";

const actions: Record<string, AutomationAction> = {
  "analyze-market": { actionId: "analyze-market", name: "Analyze Market", description: "Run trading copilot analysis for a symbol." },
  "generate-article": { actionId: "generate-article", name: "Generate Article", description: "Generate a market research article." },
  "publish-article": { actionId: "publish-article", name: "Publish Article", description: "Queue an article for publishing." },
  "summarize-news": { actionId: "summarize-news", name: "Summarize News", description: "Summarize latest market news." },
  "send-newsletter": { actionId: "send-newsletter", name: "Send Newsletter", description: "Send the newsletter to subscribers." },
};

export function getAction(actionId: string): AutomationAction | undefined {
  return actions[actionId];
}

export function getAllActions(): AutomationAction[] {
  return Object.values(actions);
}