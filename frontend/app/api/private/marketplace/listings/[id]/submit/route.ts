// app/api/private/marketplace/listings/[id]/submit/route.ts
// Sprint M9 - the ONE narrow transition endpoint the brief calls for
// (M9_product_factory.md section 8): DRAFT -> SUBMITTED, after checking
// required marketing fields are present. It is not a general field-setter
// and still cannot set trustState/evidenceId/etc directly - those are
// written only from runIngestionPipeline()'s own fresh discovery, run
// synchronously right after the transition (this sprint has no separate
// AT24-admin trigger, so the submit request itself is what causes AT24's
// processing to happen - still a single seller-facing endpoint).
//
// Ownership check and id-from-path parsing follow the exact pattern in
// ../[id]/route.ts (PATCH).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { runIngestionPipeline } from "@/services/marketplace/factory/ingestion";
import { evaluateEligibility } from "@/services/marketplace/factory/eligibility";
import {
  recordSubmittedForReview,
  recordIngestionStarted,
  recordIngestionCompleted,
  recordEligibilityEvaluated,
} from "@/services/marketplace/factory/auditTrail";

function listingIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("listings");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const sellerId = sessionUser.profile.id;

  const listingId = listingIdFromPath(ctx.path);
  if (!listingId) {
    return ApiResponse.error({ code: "VALIDATION", message: "listing id is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const listing = await withTableFallback(
    () => prisma.marketplaceListing.findFirst({ where: { id: listingId, sellerId, deletedAt: null } }),
    null,
  );
  if (!listing) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Listing not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  if (listing.publicationState !== "DRAFT") {
    return ApiResponse.error(
      { code: "CONFLICT", message: `Listing is in publicationState=${listing.publicationState}, not DRAFT -- submit is a one-time DRAFT->SUBMITTED transition.` },
      ctx.requestId,
      409,
      ctx.startedAt,
    );
  }

  if (!listing.title.trim() || !listing.description.trim()) {
    return ApiResponse.error(
      { code: "VALIDATION", message: "Required marketing fields (title, description) must be present before submission." },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { publicationState: "SUBMITTED" } });
  await recordSubmittedForReview(sellerId, listing.id);

  await recordIngestionStarted(sellerId, listing.id);
  const ingestion = await runIngestionPipeline({
    title: listing.title,
    description: listing.description,
    platformTag: listing.platformTag,
    tradingSystemId: listing.tradingSystemId,
    versionId: listing.versionId,
  });
  await recordIngestionCompleted(sellerId, listing.id, ingestion);

  const eligibility = evaluateEligibility({
    tradingSystemId: listing.tradingSystemId,
    versionId: listing.versionId,
    evidenceId: ingestion.evidenceId,
    validationId: ingestion.validationId,
    validationOverallStatus: ingestion.validationOverallStatus,
    riskAnalysisId: ingestion.riskAnalysisId,
    riskStatus: ingestion.riskStatus,
    trustState: ingestion.trustState,
    sellerId: listing.sellerId,
    requestingUserId: sellerId,
  });
  await recordEligibilityEvaluated(sellerId, listing.id, eligibility);

  const updated = await prisma.marketplaceListing.update({
    where: { id: listing.id },
    data: {
      evidenceId: ingestion.evidenceId,
      evidenceHash: ingestion.evidenceHash,
      validationId: ingestion.validationId,
      validationHash: ingestion.validationHash,
      riskAnalysisId: ingestion.riskAnalysisId,
      riskAnalysisHash: ingestion.riskAnalysisHash,
      trustState: ingestion.trustState,
      trustReasonCode: ingestion.trustReasonCode,
      trustExplanation: ingestion.trustExplanation ?? "",
      trustStatusId: ingestion.trustStatusId,
      lastEvidenceAt: ingestion.lastEvidenceAt ? new Date(ingestion.lastEvidenceAt) : null,
      publicationState: eligibility.eligible ? "READY" : "UNDER_REVIEW",
    },
  });

  return ApiResponse.success(
    {
      id: updated.id,
      slug: updated.slug,
      publicationState: updated.publicationState,
      trustState: updated.trustState,
      ingestion: { stages: ingestion.stages, failedAt: ingestion.failedAt },
      eligibility,
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
