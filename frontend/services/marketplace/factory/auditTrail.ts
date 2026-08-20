// services/marketplace/factory/auditTrail.ts
// Sprint M9 - thin wrapper scoping AuditLogService to the Factory's own
// marketplace.* actions (M9_architecture_audit.md section 5: reuse the
// existing AuditLog table, add no new one). Every stage transition the
// ingestion pipeline and submission API routes cause gets one real,
// persisted, append-only row here - never a synthesized/batched summary.
import { auditLogService, type AuditAction } from "@/services/admin/AuditLogService";
import type { IngestionResult, EligibilityResult } from "@/types/marketplace-factory";

async function recordMarketplaceEvent(params: {
  actorUserId: string;
  action: AuditAction;
  listingId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await auditLogService.record({
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: "MarketplaceListing",
    targetId: params.listingId,
    metadata: params.metadata,
  });
}

export async function recordSubmissionCreated(actorUserId: string, listingId: string, platformTag: string): Promise<void> {
  await recordMarketplaceEvent({ actorUserId, listingId, action: "marketplace.submission_created", metadata: { platformTag } });
}

export async function recordSubmissionUpdated(actorUserId: string, listingId: string, changedFields: string[]): Promise<void> {
  await recordMarketplaceEvent({ actorUserId, listingId, action: "marketplace.submission_updated", metadata: { changedFields } });
}

export async function recordSubmittedForReview(actorUserId: string, listingId: string): Promise<void> {
  await recordMarketplaceEvent({ actorUserId, listingId, action: "marketplace.submitted_for_review" });
}

export async function recordIngestionStarted(actorUserId: string, listingId: string): Promise<void> {
  await recordMarketplaceEvent({ actorUserId, listingId, action: "marketplace.ingestion_started" });
}

export async function recordIngestionCompleted(actorUserId: string, listingId: string, result: IngestionResult): Promise<void> {
  await recordMarketplaceEvent({
    actorUserId,
    listingId,
    action: "marketplace.ingestion_completed",
    metadata: { failedAt: result.failedAt, stages: result.stages },
  });
  if (result.validationId) {
    await recordMarketplaceEvent({ actorUserId, listingId, action: "marketplace.validation_completed", metadata: { validationId: result.validationId } });
  }
  if (result.riskAnalysisId) {
    await recordMarketplaceEvent({ actorUserId, listingId, action: "marketplace.risk_analysis_completed", metadata: { riskAnalysisId: result.riskAnalysisId } });
  }
  if (result.trustState) {
    await recordMarketplaceEvent({
      actorUserId,
      listingId,
      action: "marketplace.trust_evaluated",
      metadata: { trustState: result.trustState, trustReasonCode: result.trustReasonCode },
    });
  }
}

export async function recordEligibilityEvaluated(actorUserId: string, listingId: string, eligibility: EligibilityResult): Promise<void> {
  await recordMarketplaceEvent({
    actorUserId,
    listingId,
    action: "marketplace.eligibility_evaluated",
    metadata: { eligible: eligibility.eligible, rulesetVersion: eligibility.rulesetVersion, reasons: eligibility.reasons },
  });
  if (!eligibility.eligible) {
    await recordMarketplaceEvent({
      actorUserId,
      listingId,
      action: "marketplace.rejected",
      metadata: { reasons: eligibility.reasons },
    });
  }
}

export async function recordPublished(actorUserId: string, listingId: string): Promise<void> {
  await recordMarketplaceEvent({ actorUserId, listingId, action: "marketplace.published" });
}

export async function recordUnpublished(actorUserId: string, listingId: string, reason?: string): Promise<void> {
  await recordMarketplaceEvent({ actorUserId, listingId, action: "marketplace.unpublished", metadata: reason ? { reason } : undefined });
}
