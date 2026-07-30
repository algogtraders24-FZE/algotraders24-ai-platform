// app/api/private/billing/payment-config/route.ts
// Sprint L2.7 - Exposes only booleans (never a key) so the Billing UI can
// decide whether to offer a real "Proceed to Checkout" action or the
// honest "payment processing not connected" message.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { stripeProvider } from "@/services/billing/providers/StripeProvider";
import { nowPaymentsProvider } from "@/services/billing/providers/NowPaymentsProvider";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  return ApiResponse.success(
    {
      stripeConfigured: stripeProvider.isConfigured(),
      nowPaymentsConfigured: nowPaymentsProvider.isConfigured(),
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
