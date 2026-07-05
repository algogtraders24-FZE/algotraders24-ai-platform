// services/ai/prompt.service.ts
import type { PromptTemplate, PromptVariables } from "@/types/prompt";
import { promptTemplates } from "@/data/mock-prompts";

export function getTemplateById(id: string): PromptTemplate | undefined {
  return promptTemplates.find((t) => t.id === id);
}

export function buildPrompt(template: string, vars: PromptVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}