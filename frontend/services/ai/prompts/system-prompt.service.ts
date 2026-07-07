// services/ai/prompts/system-prompt.service.ts
import { classifyIntent } from "./intent-classifier.service";
import { routeIntent } from "./prompt-router.service";
import { getPersona } from "./persona.service";
import { getTemplate } from "./prompt-library.service";
import { getSchema } from "./response-schema.service";

export function buildSystemPrompt(userInput: string): string {
  const intent = classifyIntent(userInput);
  const route = routeIntent(intent);
  const persona = getPersona(route.personaId);
  const template = getTemplate(route.templateId);
  const schema = getSchema(route.schemaId);

  return [
    "Use Google Search for any current prices, live data, or recent news, then answer with real values.",
    persona.systemRole,
    `Task: ${template}`,
    `Where relevant, cover: ${schema.sections.join(", ")}.`,
    "Be professional, explain reasoning, mention risk, never guarantee profit, use markdown.",
    "",
    userInput,
  ].join("\n");
}
