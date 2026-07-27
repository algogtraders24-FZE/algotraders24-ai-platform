// services/ai/prompts/resolve-routing.service.ts
// Sprint 15D.1 - Prepares the existing dormant intent/persona scaffold
// (intent-classifier.service.ts, prompt-router.service.ts, persona
// .service.ts, prompt-library.service.ts, response-schema.service.ts - all
// pre-existing, none rewritten here) for future activation, per the
// Sprint 15D locked decision to reuse rather than rebuild it.
//
// Today a caller has to chain four separate calls (classifyIntent ->
// routeIntent -> getPersona/getTemplate/getSchema) to go from raw user
// text to a usable routing bundle. This adds the single missing
// composition step. It is NOT wired into the live chat route
// (app/api/private/knowledge/chat/route.ts) - that remains frozen per the
// Sprint 15D locked decisions - this exists so a future sprint can call
// one function instead of four.
import { classifyIntent } from "./intent-classifier.service";
import { routeIntent } from "./prompt-router.service";
import { getPersona } from "./persona.service";
import { getTemplate } from "./prompt-library.service";
import { getSchema } from "./response-schema.service";
import type { Intent } from "@/types/intent";
import type { Persona } from "@/types/persona";
import type { ResponseSchema } from "@/types/response-schema";

export interface ResolvedPromptRouting {
  intent: Intent;
  persona: Persona;
  template: string;
  schema: ResponseSchema;
}

export function resolvePromptRouting(input: string): ResolvedPromptRouting {
  const intent = classifyIntent(input);
  const route = routeIntent(intent);
  return {
    intent,
    persona: getPersona(route.personaId),
    template: getTemplate(route.templateId),
    schema: getSchema(route.schemaId),
  };
}
