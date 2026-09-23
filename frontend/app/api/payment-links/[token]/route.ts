// app/api/payment-links/[token]/route.ts
// Shareable Payment Links - public resolve, for the /pay/[token] landing
// page. Deliberately public (not under /api/private), same reasoning as
// app/api/marketplace/search/route.ts: a visitor who has never signed in
// must be able to see what they'd be buying before being asked to log in.
// Read-only - never mutates usageCount (that only happens at checkout, see
// the sibling private checkout route). Always resolves fresh against the
// live listing - see paymentLinkService.resolvePaymentLink's own comment.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { resolvePaymentLink } from "@/services/marketplace/paymentLinkService";

function tokenFromPath(reqPath: string): string | undefined {
  const segments = reqPath.split("/").filter(Boolean);
  const idx = segments.indexOf("payment-links");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (req, ctx) => {
  const token = tokenFromPath(ctx.path);
  if (!token) {
    return ApiResponse.error({ code: "VALIDATION", message: "token is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const result = await resolvePaymentLink(token);
  if ("code" in result) {
    const message = result.code === "LISTING_UNAVAILABLE" ? "This item is no longer available." : "This payment link is invalid or no longer active.";
    return ApiResponse.error({ code: result.code, message }, ctx.requestId, 404, ctx.startedAt);
  }

  return ApiResponse.success(
    {
      listing: {
        title: result.listing.title,
        description: result.listing.description,
        media: result.listing.media,
        slug: result.listing.slug,
        amount: result.listing.amount,
        currency: result.listing.currency,
      },
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
