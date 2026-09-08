// services/knowledge-loop/knowledge/ingestion-adapter.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop, K1-D: integration with the
// EXISTING, UNMODIFIED IngestionService (services/knowledge/IngestionService.ts).
//
// K1_DECISION §6 / boundary: IngestionService is CALLED, never rewritten. This
// is the thin seam so the Knowledge Loop (Governance.approve() in K4) can
// promote a `draft` Knowledge row to `active` and have its `canonicalAnswer` /
// document body chunked + embedded through the same pgvector pipeline the AI
// Assistant already uses.
//
// INV-1: ingestion is only ever invoked for a `Knowledge` row id (never a
// `KnowledgeCandidate`). `publishKnowledge` transitions to `active` FIRST,
// then ingests — a candidate has no `Knowledge` id to pass here.

import type { KnowledgeService } from "./knowledge-service";
import type { KnowledgeRecord } from "@/types/knowledge-loop";

/** The exact shape of IngestionService.ingest()'s result (unchanged). */
export interface IngestOutcome {
  knowledgeId: string;
  chunksCreated: number;
  embeddingsStored: number;
  embeddingsFailed: number;
}

/**
 * Narrow port over IngestionService so K1-D's flow is unit-testable without a
 * DB or Gemini. Production binds this to the real IngestionService (see
 * `realIngestionPort()` below); tests bind a fake.
 */
export interface IngestionPort {
  ingest(params: {
    knowledgeId: string;
    userId: string;
    text: string;
  }): Promise<IngestOutcome>;
  reembed(knowledgeId: string): Promise<IngestOutcome>;
}

/** Lazily wraps the real, unmodified IngestionService. Server-only. */
export function realIngestionPort(): IngestionPort {
  return {
    async ingest(params) {
      const { IngestionService } = await import(
        "@/services/knowledge/IngestionService"
      );
      return new IngestionService().ingest(params);
    },
    async reembed(knowledgeId) {
      const { IngestionService } = await import(
        "@/services/knowledge/IngestionService"
      );
      return new IngestionService().reembed(knowledgeId);
    },
  };
}

export interface PublishResult {
  knowledge: KnowledgeRecord;
  versionFingerprint: string;
  ingestion: IngestOutcome;
  /** true when some/all chunks failed to embed — row is still `active`. */
  reindexNeeded: boolean;
}

/**
 * Promote a `draft` Knowledge row to `active` and ingest its body.
 * Order matters (INV-1): transition first (the row is now a real active
 * Knowledge id), then chunk + embed. A partial embedding failure leaves the
 * row `active` with `reindexNeeded: true` — same non-fatal semantics as the
 * existing IngestionService.
 *
 * The AuditLog write + explicit human-approval gate belong to Governance (K4);
 * this function is the mechanical publish+ingest step it will call.
 */
export async function publishKnowledge(
  service: KnowledgeService,
  ingestion: IngestionPort,
  args: {
    knowledgeId: string;
    actorId: string;
    /** the text to chunk: canonicalAnswer for a Q&A row, or the doc body. */
    body: string;
    confidence?: number;
  },
): Promise<PublishResult> {
  const { knowledge, versionFingerprint } = await service.markActive(
    args.knowledgeId,
    args.actorId,
    args.confidence,
  );
  const outcome = await ingestion.ingest({
    knowledgeId: knowledge.id,
    userId: knowledge.userId,
    text: args.body,
  });
  const reindexNeeded =
    outcome.embeddingsFailed > 0 || outcome.embeddingsStored === 0;
  return {
    knowledge,
    versionFingerprint,
    ingestion: outcome,
    reindexNeeded,
  };
}

/** Re-index an already-active row (Governance / freshness re-review path). */
export async function reindexKnowledge(
  ingestion: IngestionPort,
  knowledgeId: string,
): Promise<IngestOutcome> {
  return ingestion.reembed(knowledgeId);
}
