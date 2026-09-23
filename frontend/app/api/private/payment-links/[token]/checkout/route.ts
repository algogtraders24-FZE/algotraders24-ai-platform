// app/api/private/payment-links/[token]/checkout/route.ts
// Shareable Payment Links - authenticated checkout via a payment link.
// Login is required (getUserOrNull -> 401), matching the locked brief's
// "no anonymous checkout" decision. Re-resolves the link and the listing
// fresh (never trusts anything cached from the /pay/[token] page load),
// re-runs the SAME release-availability check the direct marketplace
// checkout routes run, then delegates to the existing Stripe/NOWPayments
// provider methods unchanged - this route creates no Purchase/Entitlement/
// License itself, it only adds a new entry point in front of the checkout
// those providers already create. usageCount is incremented only after a
// real checkout session/invoice is created (counts attempts initiated
// through the link, not completed purchases - the locked semantics).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { withTableFallback } from "@/services/marketplace/tableGuard";
import { stripeProvider } from "@/services/billing/providers/StripeProvider";
import { nowPaymentsProvider } from "@/services/billing/providers/NowPaymentsProvider";
import { PaymentProviderError } from "@/lib/payments/errors";
import { resolvePaymentLink, recordPaymentLinkUse } from "@/services/marketplace/paymentLinkService";

// PAY-4C convention - same region pin as the direct marketplace checkout
// routes, for the same Edge Middleware -> Node cross-region 502 reason.
export const preferredRegion = "iad1";

function tokenFromPath(reqPath: string): string | undefined {
  const segments = reqPath.split("/").filter(Boolean);
  const idx = segments.indexOf("payment-links");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Please log in to continue." }, ctx.requestId, 401, ctx.startedAt);
  }
  const buyerId = sessionUser.profile.id;

  const token = tokenFromPath(ctx.path);
  if (!token) {
    return ApiResponse.error({ code: "VALIDATION", message: "token is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as { provider?: unknown } | null;
  const provider = body?.provider;
  if (provider !== "stripe" && provider !== "nowpayments") {
    return ApiResponse.error({ code: "VALIDATION", message: 'provider must be "stripe" or "nowpayments"' }, ctx.requestId, 400, ctx.startedAt);
  }

  const resolved = await resolvePaymentLink(token);
  if ("code" in resolved) {
    const message = resolved.code === "LISTING_UNAVAILABLE" ? "This item is no longer available." : "This payment link is invalid or no longer active.";
    return ApiResponse.error({ code: resolved.code, message }, ctx.requestId, 404, ctx.startedAt);
  }
  const { listing } = resolved;

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
    let checkoutUrl: string;

    if (provider === "stripe") {
      if (!stripeProvider.isConfigured()) {
        return ApiResponse.error({ code: "PROVIDER_UNCONFIGURED", message: "Payments are not configured yet" }, ctx.requestId, 503, ctx.startedAt);
      }
      const { url } = await stripeProvider.createMarketplaceCheckoutSession({
        buyerId,
        listingId: listing.id,
        listingSlug: listing.slug,
        listingTitle: listing.title,
        tradingSystemId: listing.tradingSystemId,
        versionId: listing.versionId,
        platform: listing.platformTag,
        releaseId: release.id,
        amount: listing.amount,
        currency: listing.currency,
      });
      checkoutUrl = url;
    } else {
      if (!nowPaymentsProvider.isConfigured()) {
        return ApiResponse.error({ code: "PROVIDER_UNCONFIGURED", message: "Payments are not configured yet" }, ctx.requestId, 503, ctx.startedAt);
      }
      const intent = await prisma.marketplacePurchaseIntent.create({
        data: {
          buyerId,
          marketplaceListingId: listing.id,
          tradingSystemId: listing.tradingSystemId,
          versionId: listing.versionId,
          platform: listing.platformTag,
          releaseId: release.id,
          amount: listing.amount,
          currency: listing.currency,
        },
      });
      const invoice = await nowPaymentsProvider.createMarketplaceInvoice({
        intentId: intent.id,
        priceUsd: listing.amount,
        listingTitle: listing.title,
        listingSlug: listing.slug,
      });
      await prisma.marketplacePurchaseIntent.update({ where: { id: intent.id }, data: { nowPaymentsInvoiceId: invoice.id } });
      checkoutUrl = invoice.invoiceUrl;
    }

    const recorded = await recordPaymentLinkUse(token);
    if (!recorded) {
      // The link was exhausted/expired/revoked in the instant between
      // resolve and this point (a genuine race, not a bug) - the checkout
      // session/invoice above was already created with the provider, but
      // we tell the buyer honestly rather than hand back a URL for a link
      // we can no longer vouch for.
      return ApiResponse.error(
        { code: "LINK_NO_LONGER_AVAILABLE", message: "This payment link just reached its usage limit or expired. Please ask for a new link." },
        ctx.requestId,
        409,
        ctx.startedAt,
      );
    }

    return ApiResponse.success({ url: checkoutUrl }, ctx.requestId, 200, ctx.startedAt);
  } catch (error) {
    const message = error instanceof PaymentProviderError ? error.message : "Could not start checkout";
    const status = error instanceof PaymentProviderError && error.kind === "unconfigured" ? 503 : 502;
    return ApiResponse.error({ code: "CHECKOUT_FAILED", message }, ctx.requestId, status, ctx.startedAt);
  }
});
