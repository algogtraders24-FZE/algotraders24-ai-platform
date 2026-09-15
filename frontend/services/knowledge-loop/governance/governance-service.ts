// services/knowledge-loop/governance/governance-service.ts
// Sprint K4.2-B — AT24 Knowledge Governance: approval / rejection /
// deprecation / archival / reinstatement / new-version publication.
// Contract: KNOWLEDGE_GOVERNANCE_CONTRACT.md §2-6, K4.2B_GOVERNANCE_APPROVAL.md.
//
// `GovernanceService` is the ONLY module that ever creates an `active`
// Knowledge row from a candidate, or writes an `AuditLog` row for a
// governance transition. Every method independently re-verifies the given
// `adminId` against the real `User.role` (defense-in-depth — K4.2B-D2), and
// every state change is enforced by a race-safe conditional update inside
// the store's own atomic transaction (K4.2B-D3) — never a plain read-then-
// write. `CandidateService.propose()` (K4.2-A) is untouched and unwrapped.

import type {
  ApproveOptions,
  ApproveResult,
  CandidateRecord,
  KnowledgeProvenance,
  PublishNewVersionOptions,
  PublishNewVersionResult,
  RejectResult,
  TransitionActionResult,
} from "@/types/knowledge-loop";
import { scanCandidatePrivacy } from "./privacy-scan";
import type { GovernanceStorePort } from "./ports";
import type { IngestionPort } from "../knowledge/ingestion-adapter";

export interface GovernanceServiceDeps {
  store: GovernanceStorePort;
  ingestion: IngestionPort;
  clock?: () => Date;
}

function candidateApprovable(status: CandidateRecord["status"]): boolean {
  return status === "candidate" || status === "under_review";
}

export class GovernanceService {
  private readonly store: GovernanceStorePort;
  private readonly ingestion: IngestionPort;
  private readonly now: () => Date;

  constructor(deps: GovernanceServiceDeps) {
    this.store = deps.store;
    this.ingestion = deps.ingestion;
    this.now = deps.clock ?? (() => new Date());
  }

  // ── §2.1 — Governance.approve() ────────────────────────────────────────
  async approve(
    candidateId: string,
    adminId: string,
    opts: ApproveOptions = {},
  ): Promise<ApproveResult> {
    if (!(await this.store.isAdmin(adminId))) {
      return { outcome: "unauthorized" };
    }

    const candidate = await this.store.getCandidateById(candidateId);
    if (!candidate) {
      return { outcome: "not-found" };
    }
    // an early, non-authoritative check for a nicer error path — the REAL
    // race-safe enforcement is the store's conditional update below, which
    // re-checks status inside its own transaction regardless of what we
    // read here (K4.2B-D3).
    if (!candidateApprovable(candidate.status)) {
      return { outcome: "wrong-status", candidate };
    }

    const finalAnswer = opts.editedAnswer ?? candidate.proposedAnswer;
    const editedByReviewer = finalAnswer !== candidate.proposedAnswer;

    const scan = scanCandidatePrivacy(`${candidate.canonicalQuestion}\n${finalAnswer}`);
    if (scan.blocked) {
      return { outcome: "blocked-privacy", candidate, blockedReasons: scan.reasons };
    }

    const provenance: KnowledgeProvenance = {
      ...candidate.evidence,
      ...(opts.reviewerNotes ? { reviewerNotes: opts.reviewerNotes } : {}),
      ...(editedByReviewer ? { editedByReviewer: true } : {}),
    };

    const result = await this.store.approveCandidate({
      candidateId,
      adminId,
      knowledge: {
        userId: adminId,
        title: candidate.canonicalQuestion,
        description: candidate.canonicalQuestion,
        category: "general",
        canonicalQuestion: candidate.canonicalQuestion,
        canonicalAnswer: finalAnswer,
        knowledgeType: opts.knowledgeType ?? candidate.knowledgeType,
        scope: opts.scope ?? candidate.proposedScope,
        visibility: opts.visibility ?? candidate.proposedVisibility,
        source: `candidate:${candidateId}`,
        sourceType: candidate.sourceType,
        provenance,
        confidence: candidate.confidence,
        freshnessClass: opts.freshnessClass ?? candidate.proposedFreshnessClass,
        freshnessReviewEveryDays: opts.freshnessReviewEveryDays ?? null,
        expiresAt: opts.expiresAt ?? null,
      },
      // the store enriches this with the created row's id/version/snapshot
      // once it exists — only the store's own transaction knows those.
      auditMetadata: {
        editedByReviewer,
        before: candidate,
        deprecatedRelated: opts.deprecateRelatedIds ?? [],
      },
    });

    if (result.outcome === "not-found") return { outcome: "not-found" };
    if (result.outcome === "wrong-status") return { outcome: "wrong-status", candidate: result.candidate };

    // best-effort, post-commit — deprecating unrelated existing rows is not
    // part of THIS approval's own atomic transaction (K4.2B-D1's scope is
    // the candidate->Knowledge promotion; a related row is a separate
    // aggregate). Each individual deprecate call is still atomic in itself.
    for (const relatedId of opts.deprecateRelatedIds ?? []) {
      await this.deprecate(relatedId, adminId, `superseded-by:${result.knowledge?.id}`);
    }

    // ingestion runs AFTER commit (K0.5 §2.1 step 10) — the approval itself
    // already succeeded and is already durable at this point. A total
    // ingestion failure (network down, not just some chunks failing to
    // embed) must never surface as an exception from an already-successful
    // approve() call — that would misreport a real, committed approval as a
    // failure. Treated the same as a fully-failed embed: reindexNeeded=true.
    let reindexNeeded = false;
    if (result.knowledge) {
      try {
        const outcome = await this.ingestion.ingest({
          knowledgeId: result.knowledge.id,
          userId: adminId,
          text: finalAnswer,
        });
        reindexNeeded = outcome.embeddingsFailed > 0 || outcome.embeddingsStored === 0;
      } catch {
        reindexNeeded = true;
      }
    }

    return {
      outcome: "approved",
      knowledgeId: result.knowledge?.id,
      candidate: result.candidate,
      auditLogId: result.auditLogId,
      versionFingerprint: result.versionFingerprint,
      reindexNeeded,
    };
  }

  // ── §3 — Governance.reject() ───────────────────────────────────────────
  async reject(
    candidateId: string,
    adminId: string,
    reason: string,
    closeAs: "rejected" | "duplicate" | "superseded" = "rejected",
  ): Promise<RejectResult> {
    if (!(await this.store.isAdmin(adminId))) {
      return { outcome: "unauthorized" };
    }
    const result = await this.store.rejectCandidate({
      candidateId,
      adminId,
      reason,
      closeAs,
      auditMetadata: { reason, closeAs },
    });
    if (result.outcome === "not-found") return { outcome: "not-found" };
    if (result.outcome === "wrong-status") return { outcome: "wrong-status", candidate: result.candidate };
    return { outcome: "rejected", candidate: result.candidate, auditLogId: result.auditLogId };
  }

  // ── §4 — deprecate / archive / reinstate ──────────────────────────────
  async deprecate(knowledgeId: string, adminId: string, reason?: string): Promise<TransitionActionResult> {
    return this.transition(knowledgeId, adminId, {
      fromStatuses: ["active"],
      to: "deprecated",
      action: "knowledge.deprecate",
      reason,
      outcome: "deprecated",
    });
  }

  async archive(knowledgeId: string, adminId: string): Promise<TransitionActionResult> {
    return this.transition(knowledgeId, adminId, {
      fromStatuses: ["deprecated"],
      to: "archived",
      action: "knowledge.archive",
      outcome: "archived",
    });
  }

  async reinstate(knowledgeId: string, adminId: string, reason?: string): Promise<TransitionActionResult> {
    return this.transition(knowledgeId, adminId, {
      fromStatuses: ["deprecated"],
      to: "active",
      action: "knowledge.reinstate",
      reason,
      outcome: "reinstated",
    });
  }

  private async transition(
    knowledgeId: string,
    adminId: string,
    args: {
      fromStatuses: string[];
      to: "deprecated" | "archived" | "active";
      action: string;
      reason?: string;
      outcome: "deprecated" | "archived" | "reinstated";
    },
  ): Promise<TransitionActionResult> {
    if (!(await this.store.isAdmin(adminId))) {
      return { outcome: "unauthorized" };
    }
    const result = await this.store.transitionKnowledge({
      knowledgeId,
      fromStatuses: args.fromStatuses,
      to: args.to,
      adminId,
      reason: args.reason,
      action: args.action,
      auditMetadata: { reason: args.reason ?? null },
    });
    if (result.outcome === "not-found") return { outcome: "not-found" };
    if (result.outcome === "wrong-status") return { outcome: "wrong-status", knowledge: result.knowledge };
    return {
      outcome: args.outcome,
      knowledge: result.knowledge,
      auditLogId: result.auditLogId,
      versionFingerprint: result.versionFingerprint,
    };
  }

  // ── §2.3 — Governance.publishNewVersion() ─────────────────────────────
  async publishNewVersion(
    knowledgeId: string,
    adminId: string,
    opts: PublishNewVersionOptions,
  ): Promise<PublishNewVersionResult> {
    if (!(await this.store.isAdmin(adminId))) {
      return { outcome: "unauthorized" };
    }
    const current = await this.store.getKnowledgeById(knowledgeId);
    if (!current) {
      return { outcome: "not-found" };
    }

    const provenance: KnowledgeProvenance = {
      origin: "admin-authored",
      createdBy: adminId,
      createdAt: this.now().toISOString(),
      reviewerNotes: opts.reason,
    };

    const result = await this.store.publishNewVersion({
      fromKnowledgeId: knowledgeId,
      adminId,
      newFields: {
        userId: adminId,
        title: current.title,
        description: current.description,
        category: current.category,
        canonicalQuestion: current.canonicalQuestion ?? "",
        canonicalAnswer: opts.newAnswer,
        knowledgeType: opts.knowledgeType ?? (current.knowledgeType ?? "faq"),
        scope: opts.scope ?? current.scope,
        visibility: opts.visibility ?? current.visibility,
        source: current.source,
        sourceType: current.sourceType ?? "admin_authored",
        provenance,
        confidence: current.confidence ?? 1,
        freshnessClass: opts.freshnessClass ?? (current.freshnessClass ?? "STATIC"),
        freshnessReviewEveryDays: opts.freshnessReviewEveryDays ?? current.freshnessReviewEveryDays,
        expiresAt: opts.expiresAt ?? current.expiresAt,
      },
      reason: opts.reason,
      auditMetadata: { previousVersionId: knowledgeId, reason: opts.reason },
    });

    if (result.outcome === "not-found") return { outcome: "not-found" };

    // same reasoning as approve() — ingestion runs after commit; a total
    // failure must never surface as an exception from an already-committed
    // new-version publication.
    let reindexNeeded = false;
    if (result.created) {
      try {
        const outcome = await this.ingestion.ingest({
          knowledgeId: result.created.id,
          userId: adminId,
          text: opts.newAnswer,
        });
        reindexNeeded = outcome.embeddingsFailed > 0 || outcome.embeddingsStored === 0;
      } catch {
        reindexNeeded = true;
      }
    }

    return {
      outcome: "new-version-published",
      createdKnowledgeId: result.created?.id,
      deprecatedKnowledgeId: result.deprecated?.id,
      auditLogId: result.auditLogId,
      versionFingerprint: result.versionFingerprint,
      reindexNeeded,
    };
  }
}
