// services/knowledge-loop/orchestrator/provenance-store.ts
// Sprint K3-B-2 — AT24 AI Assistant Knowledge Loop: the provenance writer.
//
// Contract: AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §8 — EVERY answer turn
// writes exactly one `KnowledgeAnswerProvenance` row (deterministic
// `sourceClass` + per-source contributions + provider attempts + latency).
// K3 is the model's FIRST writer (K1 created the table, K3_PREFLIGHT §2.5).
//
// Best-effort by design: a write failure is swallowed and never surfaces to
// the user — same `.catch(() => {})` discipline as every other persistence
// call in `knowledge/chat/route.ts`. The row is analytics, not the answer.
//
// This file imports `@/lib/prisma` — it is only ever reached through the
// dynamic-import barrel (`./index.ts`), never by a validate script (those use
// `InMemoryProvenanceStore` below).

import type { KnowledgeAnswerProvenanceInput } from "@/types/knowledge-loop";
import type { ProvenanceStorePort } from "./ports";
import { sanitizeProvenanceText } from "./build-provenance";

/** K3-C §12.6 — the persisted `providerAttempts` JSON carries BOTH the
 *  per-provider attempt trace AND the per-turn telemetry `meta` (no new
 *  column, no migration). A final defence-in-depth sanitise pass runs on
 *  every `failure` string regardless of who built the input. */
function serializeAttempts(
  input: KnowledgeAnswerProvenanceInput,
): { attempts: unknown[]; meta: unknown } {
  return {
    attempts: input.providerAttempts.map((a) => ({
      ...a,
      ...(a.failure !== undefined
        ? { failure: sanitizeProvenanceText(a.failure) }
        : {}),
    })),
    meta: input.turnMeta ?? null,
  };
}

/** Production writer — the real `KnowledgeAnswerProvenance` table. */
export class PrismaProvenanceStore implements ProvenanceStorePort {
  async write(input: KnowledgeAnswerProvenanceInput): Promise<string | null> {
    try {
      const { prisma } = await import("@/lib/prisma");
      const row = await prisma.knowledgeAnswerProvenance.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          requestId: input.requestId,
          sourceClass: input.sourceClass,
          knowledgeContributions:
            input.knowledgeContributions as unknown as object,
          webContributions: input.webContributions as unknown as object,
          providerUsed: input.providerUsed,
          providerAttempts: serializeAttempts(input) as unknown as object,
          webSearchUsed: input.webSearchUsed,
          webSearchRequestedButUnavailable:
            input.webSearchRequestedButUnavailable,
          retrievalSufficiency: input.retrievalSufficiency,
          conflict: (input.conflict as unknown as object) ?? undefined,
          integrityPassed: input.integrityPassed,
          freshnessClass: input.freshnessClass,
          privacyClass: input.privacyClass,
          candidateCreatedId: input.candidateCreatedId,
          answerCached: input.answerCached,
          servedFromCache: input.servedFromCache,
          latencyMs: input.latencyMs,
        },
        select: { id: true },
      });
      return row.id;
    } catch {
      return null; // best-effort — never break the answer
    }
  }
}

/** Offline test double — records every write for assertions. */
export class InMemoryProvenanceStore implements ProvenanceStorePort {
  readonly rows: KnowledgeAnswerProvenanceInput[] = [];
  private seq = 0;
  /** set true to simulate a DB outage (write returns null, row still recorded). */
  failWrites = false;

  async write(input: KnowledgeAnswerProvenanceInput): Promise<string | null> {
    this.rows.push(input);
    if (this.failWrites) return null;
    this.seq += 1;
    return `prov_mem_${this.seq}`;
  }
}
