// services/knowledge-loop/orchestrator/index.ts
// Sprint K3-B-2 — AT24 AI Assistant Knowledge Loop: server-only barrel.
//
// INV-1 / boundary discipline (same as ../knowledge/index.ts): this module is
// NEVER imported by services/agent-framework/*, any tool handler, the Support
// Agent, or the client bundle. Providers + the Prisma provenance writer are
// dynamically imported so a bundle that tree-shakes the orchestrator never
// pulls the DB client or a provider SDK. The validate scripts import the leaf
// files (../classifier/classify, ./web-search-gate, ./knowledge-answer-
// orchestrator, ./in-memory-adapters) directly, not this barrel.

export { classify } from "../classifier/classify";
export { webSearchGate } from "./web-search-gate";
export {
  KnowledgeAnswerOrchestrator,
} from "./knowledge-answer-orchestrator";
export type { KnowledgeAnswerOrchestratorDeps } from "./knowledge-answer-orchestrator";
export type {
  AnswerProviderSlot,
  AnswerGenInput,
  AnswerGenResult,
  ProvenanceStorePort,
  RetrievalPort,
} from "./ports";

/**
 * Default production orchestrator — the K1/K2 `KnowledgeService` (with the K2
 * retrieval cache) + the Claude→Gemini→OpenAI provider chain + the Prisma
 * `KnowledgeAnswerProvenance` writer. Lazily constructed so importing the
 * barrel opens no DB connection and loads no provider.
 *
 * Inert-safe: with no `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`OPENAI_API_KEY`
 * every slot's `isAvailable()` is false and the orchestrator returns its
 * deterministic fallback (never throws, never fabricates).
 */
export async function createKnowledgeAnswerOrchestrator() {
  const { KnowledgeAnswerOrchestrator } = await import(
    "./knowledge-answer-orchestrator"
  );
  const { createKnowledgeService } = await import("../knowledge");
  const { defaultAnswerSlots } = await import("./providers");
  const { PrismaProvenanceStore } = await import("./provenance-store");

  const knowledgeService = await createKnowledgeService({
    withRetrievalCache: true,
  });
  const slots = await defaultAnswerSlots();

  return new KnowledgeAnswerOrchestrator({
    retrieval: knowledgeService,
    slots,
    provenance: new PrismaProvenanceStore(),
  });
}
