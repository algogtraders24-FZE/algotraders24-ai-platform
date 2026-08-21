// app/api/private/marketplace/listings/[id]/checkout/route.ts
// Sprint M12 branding follow-on - starts a real, one-time Stripe Checkout
// for a Marketplace listing purchase. Any authenticated buyer may call
// this (not ownership-gated like the seller-management routes) - the real
// gate here is PUBLICLY_VISIBLE_STATES + a real PUBLISHED ReleaseArtifact,
// checked fresh against the DB every call, never cached/assumed. A
// listing with no real downloadable release can never reach a paid
// checkout through this route, regardless of its pricing/publicationState -
// see MarketplaceCatalogue.findRealRelease's own comment for why.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { stripeProvider } from "@/services/billing/providers/StripeProvider";
import { PaymentProviderError } from "@/lib/payments/errors";
import { PUBLICLY_VISIBLE_STATES } from "@/types/marketplace";

function listingIdFromPath(reqPath: string): string | undefined {
  const segments = reqPath.split("/").filter(Boolean);
  const idx = segments.indexOf("listings");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const buyerId = sessionUser.profile.id;

  const listingId = listingIdFromPath(ctx.path);
  if (!listingId) {
    return ApiResponse.error({ code: "VALIDATION", message: "listing id is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  if (!stripeProvider.isConfigured()) {
    return ApiResponse.error({ code: "PROVIDER_UNCONFIGURED", message: "Payments are not configured yet" }, ctx.requestId, 503, ctx.startedAt);
  }

  const listing = await withTableFallback(
    () => prisma.marketplaceListing.findFirst({ where: { id: listingId, deletedAt: null, publicationState: { in: PUBLICLY_VISIBLE_STATES as string[] } } }),
    null,
  );
  if (!listing) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Listing not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  const pricing = listing.pricing as Record<string, unknown> | null;
  const model = pricing && typeof pricing === "object" ? pricing.model : null;
  const amount = pricing && typeof pricing === "object" ? pricing.amount : null;
  if (model !== "one_time" || typeof amount !== "number" || amount <= 0) {
    return ApiResponse.error({ code: "NOT_PURCHASABLE", message: "This listing does not have a valid one-time price set" }, ctx.requestId, 409, ctx.startedAt);
  }

  if (!listing.tradingSystemId || !listing.versionId) {
    return ApiResponse.error({ code: "NOT_PURCHASABLE", message: "This listing is not bound to a TradingSystem/Version yet" }, ctx.requestId, 409, ctx.startedAt);
  }

  const release = await withTableFallback(
    () =>
      prisma.releaseArtifact.findFirst({
        where: { tradingSystemId: listing.tradingSystemId!, versionId: listing.versionId!, platform: listing.platformTag, releaseStatus: "PUBLISHED", deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      }),
    null,
  );
  if (!release) {
    return ApiResponse.error(
      { code: "RELEASE_NOT_AVAILABLE", message: "The seller hasn't published a downloadable build for this listing yet - nothing to purchase." },
      ctx.requestId,
      409,
      ctx.startedAt,
    );
  }

  try {
    const currency = (pricing as { currency?: string }).currency ?? "USD";
    const { url } = await stripeProvider.createMarketplaceCheckoutSession({
      buyerId,
      listingId: listing.id,
      listingSlug: listing.slug,
      listingTitle: listing.title,
      tradingSystemId: listing.tradingSystemId,
      versionId: listing.versionId,
      platform: listing.platformTag,
      releaseId: release.id,
      amount: amount as number,
      currency,
    });
    return ApiResponse.success({ url }, ctx.requestId, 200, ctx.startedAt);
  } catch (error) {
    const message = error instanceof PaymentProviderError ? error.message : "Could not start checkout";
    return ApiResponse.error({ code: "CHECKOUT_FAILED", message }, ctx.requestId, 502, ctx.startedAt);
  }
});
