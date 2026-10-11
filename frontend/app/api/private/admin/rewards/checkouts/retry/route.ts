// app/api/private/admin/rewards/checkouts/retry/route.ts
// Admin: POST { checkoutId } -> finish a contract for a payment that was confirmed but whose fulfilment failed. Safe to repeat:
// fulfilment is idempotent on the purchase, so it can never create a second contract or a second commission.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";
import { fulfilRewardCheckout, markCheckoutFailed } from "@/services/rewards/fulfilmentService";

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => null)) as { checkoutId?: unknown } | null;
  if (typeof body?.checkoutId !== "string") return ApiResponse.error({ code: "VALIDATION", message: "checkoutId is required." }, ctx.requestId, 400, ctx.startedAt);

  const checkout = await prisma.rewardCheckout.findUnique({ where: { id: body.checkoutId } });
  if (!checkout) return ApiResponse.error({ code: "NOT_FOUND", message: "Checkout not found." }, ctx.requestId, 404, ctx.startedAt);
  const intent = await prisma.marketplacePurchaseIntent.findUnique({ where: { id: checkout.intentId } });
  if (!intent) return ApiResponse.error({ code: "NOT_FOUND", message: "Payment intent not found." }, ctx.requestId, 404, ctx.startedAt);

  // The completed purchase this intent produced: same buyer and listing, created after the checkout started.
  const purchase = await prisma.purchase.findFirst({
    where: { buyerId: intent.buyerId, marketplaceListingId: intent.marketplaceListingId, status: "COMPLETED", providerRef: { not: null }, purchasedAt: { gte: checkout.createdAt } },
    orderBy: { purchasedAt: "asc" },
  });
  if (!purchase?.providerRef) return ApiResponse.error({ code: "NO_PAYMENT", message: "No confirmed payment found for this checkout, so nothing was created." }, ctx.requestId, 409, ctx.startedAt);

  try {
    const r = await fulfilRewardCheckout({ intentId: checkout.intentId, providerRef: purchase.providerRef });
    await prisma.rewardAuditEvent.create({ data: { actor: gate.user.profile.id, action: "checkout.retried", subjectType: "RewardCheckout", subjectId: checkout.id, data: { result: r.handled ? "ok" : "not-handled" } } });
    return ApiResponse.success({ ok: true, contractId: r.handled ? r.contractId : null }, ctx.requestId, 200, ctx.startedAt);
  } catch (e) {
    await markCheckoutFailed(checkout.intentId, e);
    return ApiResponse.error({ code: "RETRY_FAILED", message: e instanceof Error ? e.message.slice(0, 200) : "Retry failed." }, ctx.requestId, 502, ctx.startedAt);
  }
});
