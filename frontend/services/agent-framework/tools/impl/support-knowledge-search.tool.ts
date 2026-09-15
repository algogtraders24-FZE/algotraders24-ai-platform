// services/agent-framework/tools/impl/support-knowledge-search.tool.ts
// AT24 Agent Framework - CS1. Tool: support.knowledge_search
//
// A THIN server-side adapter over the EXISTING pgvector stack - the SAME
// GeminiEmbeddingProvider + RepositoryFactory.vectors().searchSimilar() that
// `research.knowledge_search` uses. NOT a new search engine.
//
// LOCKED (CS1.2 D2): the corpus is the platform's governed SUPPORT knowledge -
// `Knowledge` rows at `scope = "support"`, `lifecycleStatus = "active"`,
// created and curated through the K-series Knowledge foundation
// (KNOWLEDGE_CONTRACT.md). This tool retrieves it via the eligibility-filtered
// `searchSimilar` contract:
//     scopes:       ["support"]
//     visibilities: ["public", "customer"]     (authenticated-user view)
//     includeUserScope: false                  (never the caller's own KB)
// The SQL gate enforces active + not-superseded + not-expired + visibility, so
// a draft / deprecated / admin-only support row can never reach the agent.
//
// This tool calls the REPOSITORY directly (RepositoryFactory.vectors()), never
// the K-series application service - the agent framework must not reach into
// that governance layer (its INV-1). The vector repository is the shared,
// lower-level seam both sides are allowed to use.

import type { ToolDefinition, AgentEvidenceDraft } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "../tool-implementation";
import { isRecord } from "../tool-implementation";
import { placeholderFlatCost } from "../tool-credit-costs";

interface SupportKnowledgeSearchInput {
  query: string;
  topK?: number;
}

interface SupportHit {
  chunkId: string;
  knowledgeId: string;
  /** the support row's knowledgeType (faq | support | policy | product | ...) or its free-text category. */
  topic: string;
  title: string;
  content: string;
  similarity: number;
}

const MAX_TOP_K = 8;
const SUPPORT_SCOPES = ["support"] as const;
const SUPPORT_VISIBILITIES = ["public", "customer"] as const;

// `searchSimilar` returns the top-K by cosine similarity regardless of how
// weak the match is. A support answer must not be built on noise, and the
// "no answer -> escalate" path (CS1.2 D5) depends on genuinely-empty results.
// So drop anything below this floor here; the specialist then applies a
// STRONG-match threshold on top for the `kb-answered` vs `no-coverage`
// decision. (Ballpark of the K retrieval contract's RELEVANCE_MIN 0.3, set
// higher for a customer-facing answer.)
const SUPPORT_MIN_SIMILARITY = 0.45;

const definition: ToolDefinition = {
  id: "support.knowledge_search",
  name: "Support Knowledge Search",
  description:
    "Semantic (vector) search over the platform's governed support knowledge (scope=support: FAQ / products / " +
    "billing / credits / purchases / licenses / troubleshooting / policies / verified resolutions). Read-only. " +
    "Only active, in-visibility support rows are returned; never a user's own knowledge base.",
  version: "1.0.0",
  category: "SUPPORT",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", minLength: 1 },
      topK: { type: "integer", minimum: 1, maximum: MAX_TOP_K },
    },
    required: ["query"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["CAN_RUN_SUPPORT"],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: placeholderFlatCost("support.knowledge_search") },
  executionMode: "sync",
  // CS1.2 D2 (NO MIGRATION): AgentEvidenceType is a Postgres enum; support
  // evidence reuses "research_document" (a retrieved knowledge chunk IS one).
  // The support-vs-user-KB distinction is carried by `source` ("support-kb:*")
  // and `provenance.producer` ("support-kb-vector-search"), never by a new
  // enum value.
  evidence: {
    producesEvidence: true,
    evidenceTypes: ["research_document"],
    provenanceProducer: "support-kb-vector-search",
  },
  status: "active",
  wraps:
    "repositories/VectorRepository.ts (RepositoryFactory.vectors().searchSimilar, scopes=['support']) + lib/ai GeminiEmbeddingProvider",
};

function parseInput(raw: unknown): ToolInputParseResult<SupportKnowledgeSearchInput> {
  if (!isRecord(raw)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  const query = raw.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    return { ok: false, violations: [{ path: "query", message: "query is required (non-empty string)." }] };
  }
  const out: SupportKnowledgeSearchInput = { query: query.trim() };
  if (raw.topK !== undefined) {
    if (typeof raw.topK !== "number" || !Number.isInteger(raw.topK) || raw.topK < 1) {
      return { ok: false, violations: [{ path: "topK", message: "topK must be a positive integer." }] };
    }
    out.topK = Math.min(raw.topK, MAX_TOP_K);
  }
  return { ok: true, value: out };
}

function checkOutput(value: unknown) {
  if (!isRecord(value)) return contractResult([{ path: "", message: "output must be an object." }]);
  if (!Array.isArray(value.hits)) return contractResult([{ path: "hits", message: "output.hits must be an array." }]);
  if (typeof value.available !== "boolean") {
    return contractResult([{ path: "available", message: "output.available must be a boolean." }]);
  }
  return contractOk();
}

function toEvidence(query: string, hits: SupportHit[]): AgentEvidenceDraft[] {
  const now = new Date().toISOString();
  return hits.map((h) => ({
    type: "research_document", // CS1.2 D2 - reused enum; "support-kb:" source is the real discriminator
    claim: h.content.length > 280 ? `${h.content.slice(0, 280)}…` : h.content,
    source: `support-kb:${h.topic}`,
    sourceId: h.chunkId,
    timestamp: now,
    data: {
      chunkId: h.chunkId,
      knowledgeId: h.knowledgeId,
      topic: h.topic,
      title: h.title,
      similarity: h.similarity,
      query,
    },
    relevance: Math.max(0, Math.min(1, h.similarity)),
    confidence: Math.max(0, Math.min(1, h.similarity)),
    provenance: { producer: "support-kb-vector-search", retrievedAt: now },
  }));
}

export const supportKnowledgeSearchTool: ToolImplementation<
  SupportKnowledgeSearchInput,
  { hits: SupportHit[]; available: boolean }
> = {
  definition,
  parseInput,
  checkOutput,
  async handler(input) {
    const [{ GeminiEmbeddingProvider }, { RepositoryFactory }, { prisma }] = await Promise.all([
      import("@/lib/ai"),
      import("@/repositories/RepositoryFactory"),
      import("@/lib/prisma"),
    ]);

    let hits: SupportHit[] = [];
    try {
      const embedder = new GeminiEmbeddingProvider();
      const embedded = await embedder.embed({ text: input.query });
      const rows = await RepositoryFactory.vectors().searchSimilar({
        embedding: embedded.embedding,
        topK: input.topK ?? 5,
        scopes: [...SUPPORT_SCOPES],
        visibilities: [...SUPPORT_VISIBILITIES],
        includeUserScope: false, // the support corpus only - never the caller's own rows
      });

      const relevant = rows.filter((r) => r.similarity >= SUPPORT_MIN_SIMILARITY);
      const knowledgeIds = [...new Set(relevant.map((r) => r.knowledgeId))];
      const docs = await prisma.knowledge.findMany({
        where: { id: { in: knowledgeIds }, scope: "support", deletedAt: null },
        select: { id: true, category: true, title: true, knowledgeType: true },
      });
      const docById = new Map(docs.map((d) => [d.id, d]));

      hits = relevant.map((r) => {
        const doc = docById.get(r.knowledgeId);
        return {
          chunkId: r.chunkId,
          knowledgeId: r.knowledgeId,
          topic: doc?.knowledgeType ?? doc?.category ?? "support",
          title: doc?.title ?? "",
          content: r.content,
          similarity: r.similarity,
        };
      });
    } catch {
      // embedding provider / DB unavailable - honest empty, never fatal,
      // never a fabricated answer.
      return { output: { hits: [], available: false }, evidence: [] };
    }

    return { output: { hits, available: true }, evidence: toEvidence(input.query, hits) };
  },
};
