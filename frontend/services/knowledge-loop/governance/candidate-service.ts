// services/knowledge-loop/governance/candidate-service.ts
// Sprint K4.2-A — AT24 Knowledge Governance: candidate capture.
// Contract: KNOWLEDGE_GOVERNANCE_CONTRACT.md §7-8, K4.2A_CANDIDATE_CAPTURE.md.
//
// `CandidateService.propose()` is the ONLY function in this codebase that
// creates a `KnowledgeCandidate` row. It NEVER imports `KnowledgeService`,
// NEVER calls `markActive`/`createVersionOf`/`deprecate`/`archive`/
// `reinstate`, and NEVER writes `Knowledge` or `KnowledgeChunk` — that is the
// K4.2-A governance boundary (K4.2A-D4), asserted structurally by
// `validate-k4.2a-candidate-capture.ts`. Publication (`Governance.approve()`)
// is K4.2-B — does not exist yet.
//
// AI callers may call `propose()` (K4.1 §17: "AI may propose candidates").
// They may NEVER reach `Knowledge` directly — this module is the only door,
// and it only ever leads to a non-authoritative, structurally-unretrievable
// `KnowledgeCandidate` row (INV-1 holds unchanged, K4.2A-D5).

import { KNOWLEDGE_LOOP_CONFIG } from "@/config/knowledge-loop.config";
import type {
  KnowledgeProvenance,
  ProposeCandidateInput,
  ProposeCandidateResult,
} from "@/types/knowledge-loop";
import {
  scanCandidateForbiddenLanguage,
  scanCandidatePrivacy,
} from "./privacy-scan";
import type {
  CandidateStorePort,
  EmbeddingPort,
  VectorSearchPort,
} from "./ports";

const C = KNOWLEDGE_LOOP_CONFIG;

// dedup asks "does this fact already exist," not "can this caller see it" —
// deliberately all visibilities (K4.2A-D2).
const ALL_VISIBILITIES = ["public", "customer", "admin", "internal"];
const DEDUP_TOP_K = 5;

export interface CandidateServiceDeps {
  store: CandidateStorePort;
  embed: EmbeddingPort;
  vectors: VectorSearchPort;
  clock?: () => Date;
}

export class CandidateService {
  private readonly store: CandidateStorePort;
  private readonly embed: EmbeddingPort;
  private readonly vectors: VectorSearchPort;
  private readonly now: () => Date;

  constructor(deps: CandidateServiceDeps) {
    this.store = deps.store;
    this.embed = deps.embed;
    this.vectors = deps.vectors;
    this.now = deps.clock ?? (() => new Date());
  }

  async propose(input: ProposeCandidateInput): Promise<ProposeCandidateResult> {
    // ── §2.2 structural validation — a contract rule, not a thrown error. ──
    if (
      input.sourceType === "web_researched" &&
      (input.evidence?.webSources?.length ?? 0) === 0
    ) {
      return {
        outcome: "blocked-invalid",
        invalidReason:
          "sourceType=web_researched requires at least one evidence.webSources entry (KNOWLEDGE_CONTRACT.md §8)",
        forbiddenLanguageWarnings: [],
      };
    }

    const proposedScope = input.proposedScope ?? "assistant";
    const proposedVisibility = input.proposedVisibility ?? "public";
    const proposedFreshnessClass = input.proposedFreshnessClass ?? "STATIC";
    const originatingConversationId = input.originatingConversationId ?? null;
    const originatingMessageId = input.originatingMessageId ?? null;

    // ── K4.2A-D3 — idempotency, checked BEFORE privacy/dedup do any work. ──
    const existing = originatingMessageId
      ? await this.store.findByOriginatingMessage(input.sourceType, originatingMessageId)
      : await this.store.findByExactContent(
          input.createdByUserId,
          input.sourceType,
          input.canonicalQuestion,
          input.proposedAnswer,
        );
    if (existing) {
      return { outcome: "idempotent-replay", candidate: existing, forbiddenLanguageWarnings: [] };
    }

    // ── K0.5 §7.2 — privacy scan, block-on-hit, before any row is created. ──
    const scanText = `${input.canonicalQuestion}\n${input.proposedAnswer}`;
    const privacy = scanCandidatePrivacy(scanText);
    const forbiddenLanguageWarnings = scanCandidateForbiddenLanguage(scanText);
    if (privacy.blocked) {
      return {
        outcome: "blocked-privacy",
        blockedReasons: privacy.reasons,
        forbiddenLanguageWarnings,
      };
    }

    // ── K4.2A-D2 — dedup against active knowledge in the same scope. ──
    const embedding = await this.embed.embed(input.canonicalQuestion);
    const hits = await this.vectors.searchSimilar({
      embedding,
      topK: DEDUP_TOP_K,
      scopes: [proposedScope],
      visibilities: ALL_VISIBILITIES,
      includeUserScope: false,
      callerUserId: "",
    });
    let bestKnowledgeId: string | null = null;
    let bestSimilarity = 0;
    for (const h of hits) {
      if (h.similarity > bestSimilarity) {
        bestSimilarity = h.similarity;
        bestKnowledgeId = h.knowledgeId;
      }
    }

    const isHardDuplicate = bestKnowledgeId !== null && bestSimilarity >= C.DUP_HARD;
    const isSoftDuplicate =
      !isHardDuplicate && bestKnowledgeId !== null && bestSimilarity >= C.DUP_SOFT;

    const evidence: KnowledgeProvenance = {
      origin: "candidate",
      createdBy: input.createdByUserId,
      createdAt: this.now().toISOString(),
      ...(originatingConversationId ? { originatingConversationId } : {}),
      ...(originatingMessageId ? { originatingMessageId } : {}),
      ...(input.evidence?.knowledgeSources ? { knowledgeSources: input.evidence.knowledgeSources } : {}),
      ...(input.evidence?.webSources ? { webSources: input.evidence.webSources } : {}),
    };

    const candidate = await this.store.create({
      createdByUserId: input.createdByUserId,
      originatingConversationId,
      originatingMessageId,
      canonicalQuestion: input.canonicalQuestion,
      proposedAnswer: input.proposedAnswer,
      knowledgeType: input.knowledgeType,
      proposedScope,
      proposedVisibility,
      proposedFreshnessClass,
      sourceType: input.sourceType,
      evidence,
      confidence: input.confidence,
      reasonForCandidate: input.reasonForCandidate,
      duplicateOfId: isHardDuplicate || isSoftDuplicate ? bestKnowledgeId : null,
      similarityScore: isHardDuplicate || isSoftDuplicate ? bestSimilarity : null,
      status: isHardDuplicate ? "duplicate" : "candidate",
    });

    return {
      outcome: isHardDuplicate ? "duplicate-of-active" : "created",
      candidate,
      forbiddenLanguageWarnings,
    };
  }
}
