// services/agent-framework/tools/impl/support-knowledge-search.core.ts
// AT24 Agent Framework - CS1/P1. The shared retrieval core behind
// `support.knowledge_search` (support-knowledge-search.tool.ts, authenticated
// users, scope=support + visibility public/customer) AND the P1 guest-safe
// KB query (services/support/guest-knowledge-query.ts, anonymous visitors,
// visibility public ONLY).
//
// Extracted, non-behaviorally, from the CS1 tool
// (AUTONOMOUS_SUPPORT_P1_CONTRACT.md SS17): identical embed -> searchSimilar
// -> min-similarity filter -> title-join sequence, byte-identical output for
// the authenticated tool's existing ["public","customer"] call. The ONLY
// parameter that differs between callers is `visibilities` - the
// authenticated tool always passes ["public","customer"], the guest path
// always passes ["public"]. Neither caller may pass a caller-supplied value
// here - both hard-code their own literal array (P1 SS11/SS16: the
// visibility filter must never be derived from a request body or a model's
// judgment).

export const SUPPORT_SCOPES = ["support"] as const;

// `searchSimilar` returns the top-K by cosine similarity regardless of how
// weak the match is. A support answer must not be built on noise, and the
// "no answer -> escalate" path (CS1.2 D5) depends on genuinely-empty
// results. So drop anything below this floor here.
export const SUPPORT_MIN_SIMILARITY = 0.45;
export const MAX_SUPPORT_TOP_K = 8;

export interface SupportHit {
  chunkId: string;
  knowledgeId: string;
  /** the support row's knowledgeType (faq | support | policy | product | ...) or its free-text category. */
  topic: string;
  title: string;
  content: string;
  similarity: number;
}

export interface SupportKnowledgeSearchResult {
  hits: SupportHit[];
  available: boolean;
}

/** The shared embed -> searchSimilar -> filter -> title-join sequence. Never
 *  throws - an embedding/DB failure returns an honest empty result
 *  (available:false), never a fabricated answer. */
export async function searchSupportKnowledge(
  query: string,
  opts: { visibilities: readonly string[]; topK?: number },
): Promise<SupportKnowledgeSearchResult> {
  const topK = Math.min(opts.topK ?? 5, MAX_SUPPORT_TOP_K);

  try {
    const [{ GeminiEmbeddingProvider }, { RepositoryFactory }, { prisma }] = await Promise.all([
      import("@/lib/ai"),
      import("@/repositories/RepositoryFactory"),
      import("@/lib/prisma"),
    ]);

    const embedder = new GeminiEmbeddingProvider();
    const embedded = await embedder.embed({ text: query });
    const rows = await RepositoryFactory.vectors().searchSimilar({
      embedding: embedded.embedding,
      topK,
      scopes: [...SUPPORT_SCOPES],
      visibilities: [...opts.visibilities],
      includeUserScope: false, // the support corpus only - never a caller's own rows
    });

    const relevant = rows.filter((r) => r.similarity >= SUPPORT_MIN_SIMILARITY);
    const knowledgeIds = [...new Set(relevant.map((r) => r.knowledgeId))];
    const docs = await prisma.knowledge.findMany({
      where: { id: { in: knowledgeIds }, scope: "support", deletedAt: null },
      select: { id: true, category: true, title: true, knowledgeType: true },
    });
    const docById = new Map(docs.map((d) => [d.id, d]));

    const hits: SupportHit[] = relevant.map((r) => {
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

    return { hits, available: true };
  } catch {
    // embedding provider / DB unavailable - honest empty, never fatal, never
    // a fabricated answer.
    return { hits: [], available: false };
  }
}
