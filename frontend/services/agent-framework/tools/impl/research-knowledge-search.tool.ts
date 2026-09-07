// services/agent-framework/tools/impl/research-knowledge-search.tool.ts
// AT24 Agent Framework - A11. Tool: research.knowledge_search
//
// A THIN server-side adapter over the EXISTING Knowledge/RAG stack - the
// same pgvector search the AI Assistant already uses:
//   GeminiEmbeddingProvider.embed()  +  RepositoryFactory.vectors().searchSimilar()
// (see app/api/private/knowledge/search/route.ts). NOT a new research engine.
// Results are ALWAYS scoped to the owning user's own knowledge chunks.

import type { ToolDefinition, AgentEvidenceDraft } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "../tool-implementation";
import { isRecord } from "../tool-implementation";
import { placeholderFlatCost } from "../tool-credit-costs";

interface KnowledgeSearchInput {
  query: string;
  topK?: number;
  knowledgeId?: string;
}

interface KnowledgeHit {
  chunkId: string;
  knowledgeId: string;
  content: string;
  similarity: number;
}

const MAX_TOP_K = 10;

const definition: ToolDefinition = {
  id: "research.knowledge_search",
  name: "Knowledge Search",
  description:
    "Semantic (vector) search over the owning user's own knowledge base. Returns the most relevant chunks with a similarity score. Read-only; user-scoped.",
  version: "1.0.0",
  category: "RESEARCH",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", minLength: 1 },
      topK: { type: "integer", minimum: 1, maximum: MAX_TOP_K },
      knowledgeId: { type: "string" },
    },
    required: ["query"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["CAN_RUN_RESEARCH"],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: placeholderFlatCost("research.knowledge_search") },
  executionMode: "sync",
  evidence: {
    producesEvidence: true,
    evidenceTypes: ["research_document"],
    provenanceProducer: "knowledge-vector-search",
  },
  status: "active",
  wraps: "repositories/VectorRepository.ts (RepositoryFactory.vectors().searchSimilar) + lib/ai GeminiEmbeddingProvider",
};

function parseInput(raw: unknown): ToolInputParseResult<KnowledgeSearchInput> {
  if (!isRecord(raw)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  const query = raw.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    return { ok: false, violations: [{ path: "query", message: "query is required (non-empty string)." }] };
  }
  const out: KnowledgeSearchInput = { query: query.trim() };
  if (raw.topK !== undefined) {
    if (typeof raw.topK !== "number" || !Number.isInteger(raw.topK) || raw.topK < 1) {
      return { ok: false, violations: [{ path: "topK", message: "topK must be a positive integer." }] };
    }
    out.topK = Math.min(raw.topK, MAX_TOP_K);
  }
  if (raw.knowledgeId !== undefined) {
    if (typeof raw.knowledgeId !== "string" || raw.knowledgeId.trim().length === 0) {
      return { ok: false, violations: [{ path: "knowledgeId", message: "knowledgeId must be a non-empty string." }] };
    }
    out.knowledgeId = raw.knowledgeId.trim();
  }
  return { ok: true, value: out };
}

function checkOutput(value: unknown) {
  if (!isRecord(value)) return contractResult([{ path: "", message: "output must be an object." }]);
  if (!Array.isArray(value.hits)) return contractResult([{ path: "hits", message: "output.hits must be an array." }]);
  return contractOk();
}

function toEvidence(query: string, hits: KnowledgeHit[]): AgentEvidenceDraft[] {
  const now = new Date().toISOString();
  return hits.map((h) => ({
    type: "research_document",
    claim: h.content.length > 240 ? `${h.content.slice(0, 240)}…` : h.content,
    source: `knowledge:${h.knowledgeId}`,
    sourceId: h.chunkId,
    timestamp: now,
    data: { chunkId: h.chunkId, knowledgeId: h.knowledgeId, similarity: h.similarity, query },
    relevance: Math.max(0, Math.min(1, h.similarity)),
    confidence: Math.max(0, Math.min(1, h.similarity)),
    provenance: { producer: "knowledge-vector-search", retrievedAt: now },
  }));
}

export const researchKnowledgeSearchTool: ToolImplementation<KnowledgeSearchInput, { hits: KnowledgeHit[] }> = {
  definition,
  parseInput,
  checkOutput,
  async handler(input, ctx) {
    // Lazy imports: keep the Gemini SDK + repository layer out of the pure
    // contract/test paths.
    const [{ GeminiEmbeddingProvider }, { RepositoryFactory }] = await Promise.all([
      import("@/lib/ai"),
      import("@/repositories/RepositoryFactory"),
    ]);
    const embedder = new GeminiEmbeddingProvider();
    const embedded = await embedder.embed({ text: input.query });
    const rows = await RepositoryFactory.vectors().searchSimilar({
      embedding: embedded.embedding,
      topK: input.topK ?? 5,
      userId: ctx.userId, // session-derived; never from tool input
      knowledgeId: input.knowledgeId,
    });
    const hits: KnowledgeHit[] = rows.map((r) => ({
      chunkId: r.chunkId,
      knowledgeId: r.knowledgeId,
      content: r.content,
      similarity: r.similarity,
    }));
    return { output: { hits }, evidence: toEvidence(input.query, hits) };
  },
};
