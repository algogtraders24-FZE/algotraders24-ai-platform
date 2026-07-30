// app/api/private/billing/crypto-invoice/route.ts
// Sprint L2.7 - Phase 3: real NOWPayments invoice creation. NOWPayments has
// no native recurring-subscription concept (unlike Stripe) - this pays for
// exactly one billing period upfront; renewing requires creating a new
// invoice next period. That's a real, disclosed limitation of the
// provider, not something this route pretends to smooth over.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { nowPaymentsProvider } from "@/services/billing/providers/NowPaymentsProvider";
import { PaymentProviderError } from "@/lib/payments/errors";
import { isPlanId } from "@/config/plan-limits";
import { prisma } from "@/lib/prisma";

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  if (!nowPaymentsProvider.isConfigured()) {
    return ApiResponse.error(
      { code: "PROVIDER_UNCONFIGURED", message: "NOWPayments is not configured on this deployment." },
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

  const plan = await prisma.plan.findUnique({ where: { id: body.planId } });
  if (!plan || plan.price <= 0) {
    return ApiResponse.error({ code: "VALIDATION", message: "Plan is not a valid paid plan" }, ctx.requestId, 400, ctx.startedAt);
  }
  const priceUsd = cycle === "yearly" ? plan.price * 12 : plan.price;
  const orderId = `${sessionUser.profile.id}:${plan.id}:${cycle}:${Date.now()}`;

  try {
    const invoice = await nowPaymentsProvider.createInvoice({
      userId: sessionUser.profile.id,
      planId: plan.id,
      priceUsd,
      orderId,
    });
    return ApiResponse.success({ invoiceUrl: invoice.invoiceUrl, invoiceId: invoice.id }, ctx.requestId, 200, ctx.startedAt);
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      const status = error.kind === "unconfigured" ? 503 : error.kind === "auth" ? 502 : 502;
      return ApiResponse.error({ code: "PAYMENT_PROVIDER_ERROR", message: error.message }, ctx.requestId, status, ctx.startedAt);
    }
    return ApiResponse.error({ code: "INVOICE_FAILED", message: "Could not create invoice" }, ctx.requestId, 500, ctx.startedAt);
  }
});
