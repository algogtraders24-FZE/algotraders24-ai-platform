// app/api/private/marketplace/listings/[id]/crypto-invoice/route.ts
// NOWPayments counterpart to ../checkout/route.ts (Stripe). Same real gates
// (PUBLICLY_VISIBLE_STATES, valid one_time pricing, a real PUBLISHED
// ReleaseArtifact) - a listing that can't be bought via Stripe can't be
// bought via crypto either. Persists a MarketplacePurchaseIntent row before
// calling NOWPayments, since the IPN webhook gets back only order_id and
// needs somewhere to recover buyer/listing/release context from.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { nowPaymentsProvider } from "@/services/billing/providers/NowPaymentsProvider";
import { PaymentProviderError } from "@/lib/payments/errors";
import { PUBLICLY_VISIBLE_STATES } from "@/types/marketplace";

// PAY-4C - same region pin as ../checkout/route.ts (Stripe): production
// smoke testing found the Edge Middleware -> Node function region handoff
// intermittently returning a raw platform 502 despite this handler
// completing successfully. Pinning removes that cross-region hop.
export const preferredRegion = "iad1";

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

  if (!nowPaymentsProvider.isConfigured()) {
    return ApiResponse.error({ code: "PROVIDER_UNCONFIGURED", message: "NOWPayments is not configured on this deployment." }, ctx.requestId, 503, ctx.startedAt);
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

  const currency = (pricing as { currency?: string }).currency ?? "USD";

  try {
    const intent = await prisma.marketplacePurchaseIntent.create({
      data: {
        buyerId,
        marketplaceListingId: listing.id,
        tradingSystemId: listing.tradingSystemId,
        versionId: listing.versionId,
        platform: listing.platformTag,
        releaseId: release.id,
        amount: amount as number,
        currency,
      },
    });

    const invoice = await nowPaymentsProvider.createMarketplaceInvoice({
      intentId: intent.id,
      priceUsd: amount as number,
      listingTitle: listing.title,
      listingSlug: listing.slug,
    });

    await prisma.marketplacePurchaseIntent.update({
      where: { id: intent.id },
      data: { nowPaymentsInvoiceId: invoice.id },
    });

    return ApiResponse.success({ invoiceUrl: invoice.invoiceUrl, invoiceId: invoice.id }, ctx.requestId, 200, ctx.startedAt);
  } catch (error) {
    const message = error instanceof PaymentProviderError ? error.message : "Could not create invoice";
    const status = error instanceof PaymentProviderError && error.kind === "unconfigured" ? 503 : 502;
    return ApiResponse.error({ code: "INVOICE_FAILED", message }, ctx.requestId, status, ctx.startedAt);
  }
});
