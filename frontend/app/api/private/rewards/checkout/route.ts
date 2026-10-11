// app/api/private/rewards/checkout/route.ts
// POST { productKey, acceptTerms, acceptRefundPolicy } -> { invoiceUrl }. Starts an Algo Contracts purchase.
// Everything is decided on the server (see services/rewards/checkoutService.ts); the browser only names the product.
import { cookies } from "next/headers";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { checkAndRecordCheckoutAttempt, CHECKOUT_RATE_LIMIT_MESSAGE } from "@/lib/security/checkoutRateLimit";
import { startRewardCheckout } from "@/services/rewards/checkoutService";
import { REF_COOKIE } from "@/lib/rewards/referral";

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const limit = await checkAndRecordCheckoutAttempt(user.profile.id);
  if (!limit.allowed) return ApiResponse.error({ code: "RATE_LIMITED", message: CHECKOUT_RATE_LIMIT_MESSAGE }, ctx.requestId, 429, ctx.startedAt);

  const body = (await req.json().catch(() => null)) as { productKey?: unknown; acceptTerms?: unknown; acceptRefundPolicy?: unknown } | null;
  const jar = await cookies();
  const r = await startRewardCheckout({
    userId: user.profile.id,
    email: user.profile.email,
    productKey: body?.productKey,
    acceptTerms: body?.acceptTerms,
    acceptRefundPolicy: body?.acceptRefundPolicy,
    refCookie: jar.get(REF_COOKIE)?.value ?? null,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  if (!r.ok) {
    return ApiResponse.error({ code: r.code, message: r.reasons && r.reasons.length > 1 ? r.reasons.join(" ") : r.message }, ctx.requestId, r.status, ctx.startedAt);
  }
  return ApiResponse.success({ invoiceUrl: r.invoiceUrl }, ctx.requestId, 200, ctx.startedAt);
});
