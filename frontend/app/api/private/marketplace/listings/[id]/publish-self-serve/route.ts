// app/api/private/marketplace/listings/[id]/publish-self-serve/route.ts
// Seller self-serve (Phase 1): publish a listing WITHOUT AT24 evidence. The listing goes live as "Not checked" - trustState
// stays null (never set here), nothing about performance is claimed by AT24, and the existing evidence route
// (.../submit) is untouched. Buying turns on by itself because a PUBLISHED release now exists for the listing.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { auditLogService } from "@/services/admin/AuditLogService";
import { sellerVerificationBlocker, selfServeAllowedFor, isPlatformOwner, checkPublishRequirements, MAX_NEW_LISTINGS_PER_DAY } from "@/lib/marketplace/selfServe";

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
  const email = sessionUser.profile.email;
  if (!selfServeAllowedFor(email)) {
    return ApiResponse.error({ code: "SELF_SERVE_UNAVAILABLE", message: "Self-serve listing is not open for this account yet." }, ctx.requestId, 403, ctx.startedAt);
  }


  const unverified = sellerVerificationBlocker({ email: email, emailVerified: sessionUser.profile.emailVerified });
  if (unverified) {
    return ApiResponse.error({ code: "SELLER_NOT_VERIFIED", message: unverified }, ctx.requestId, 403, ctx.startedAt);
  }

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
    return ApiResponse.error({ code: "CONFLICT", message: `This listing is already ${listing.publicationState}.` }, ctx.requestId, 409, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const acceptTerms = body?.acceptTerms === true;

  const release = listing.tradingSystemId && listing.versionId
    ? await prisma.releaseArtifact.findFirst({
        where: { tradingSystemId: listing.tradingSystemId, versionId: listing.versionId, platform: listing.platformTag, releaseStatus: "PUBLISHED", deletedAt: null },
        select: { id: true },
      })
    : null;

  const missing = checkPublishRequirements({
    title: listing.title,
    description: listing.description,
    media: listing.media,
    pricing: listing.pricing,
    hasBuild: !!release,
    acceptTerms,
  });
  if (missing.length > 0) {
    return ApiResponse.error({ code: "NOT_READY", message: `Before publishing you still need: ${missing.join(", ")}.` }, ctx.requestId, 422, ctx.startedAt);
  }

  // Spam brake: at most N brand-new listings per seller per 24h (the platform owner is exempt).
  if (!isPlatformOwner(email)) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await prisma.marketplaceListing.count({ where: { sellerId, deletedAt: null, publicationState: { in: ["PUBLISHED", "READY"] }, updatedAt: { gte: since } } });
    if (recent >= MAX_NEW_LISTINGS_PER_DAY) {
      return ApiResponse.error({ code: "DAILY_LIMIT", message: `You can publish up to ${MAX_NEW_LISTINGS_PER_DAY} new listings per day. Please try again tomorrow.` }, ctx.requestId, 429, ctx.startedAt);
    }
  }

  const updated = await prisma.marketplaceListing.update({
    where: { id: listing.id },
    data: { publicationState: "PUBLISHED" },
  });
  await auditLogService.record({
    actorUserId: sellerId,
    action: "marketplace.published",
    targetType: "MarketplaceListing",
    targetId: listing.id,
    metadata: { path: "self-serve", trustState: null, termsAcceptedAt: new Date().toISOString(), releaseId: release?.id },
  });

  return ApiResponse.success(
    { id: updated.id, slug: updated.slug, publicationState: updated.publicationState, trustState: updated.trustState },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
