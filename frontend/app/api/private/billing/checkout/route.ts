// app/api/private/billing/checkout/route.ts
// Sprint L2.7 - Phase 2: real Stripe Checkout session creation. Returns an
// honest "not configured" error (never a fake success) when Stripe isn't
// wired in this environment - see StripeProvider.isConfigured().
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { stripeProvider } from "@/services/billing/providers/StripeProvider";
import { PaymentProviderError } from "@/lib/payments/errors";
import { isPlanId } from "@/config/plan-limits";

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  if (!stripeProvider.isConfigured()) {
    return ApiResponse.error(
      { code: "PROVIDER_UNCONFIGURED", message: "Stripe is not configured on this deployment." },
      ctx.requestId,
      503,
      ctx.startedAt,
    );
  }

  const body = (await req.json().catch(() => null)) as { planId?: unknown; cycle?: unknown } | null;
  if (typeof body?.planId !== "string" || !isPlanId(body.planId)) {
    return ApiResponse.error({ code: "VALIDATION", message: "planId must be a valid plan id" }, ctx.requestId, 400, ctx.startedAt);
  }
  const cycle = body.cycle === "yearly" ? "yearly" : "monthly";

  try {
    const { url } = await stripeProvider.createCheckoutSession({
      userId: sessionUser.profile.id,
      planId: body.planId,
      cycle,
    });
    return ApiResponse.success({ url }, ctx.requestId, 200, ctx.startedAt);
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      const status = error.kind === "unconfigured" ? 503 : 502;
      return ApiResponse.error({ code: "PAYMENT_PROVIDER_ERROR", message: error.message }, ctx.requestId, status, ctx.startedAt);
    }
    return ApiResponse.error({ code: "CHECKOUT_FAILED", message: "Could not create checkout session" }, ctx.requestId, 500, ctx.startedAt);
  }
});
