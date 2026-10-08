// app/api/private/seller/earnings/route.ts
// Seller self-serve Phase 4 - the seller's own earnings.
//   GET  -> { summary, sales[], payouts[], rules }
//   POST { network, address } -> request a USDT payout of the WHOLE available balance (min 50 USD, one open request at a time)
// Always scoped to the signed-in user; no seller id is ever taken from the request.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { auditLogService } from "@/services/admin/AuditLogService";
import { getSellerEarnings, requestPayout } from "@/services/marketplace/earningsStore";
import { COMMISSION_RATE, HOLD_DAYS, MIN_PAYOUT_USD, PAYOUT_NETWORKS } from "@/lib/marketplace/earnings";

const RULES = { commissionRate: COMMISSION_RATE, holdDays: HOLD_DAYS, minPayoutUsd: MIN_PAYOUT_USD, networks: PAYOUT_NETWORKS, method: "USDT" };

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const view = await getSellerEarnings(user.profile.id);
  return ApiResponse.success({ ...view, rules: RULES }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const body = (await req.json().catch(() => null)) as { network?: unknown; address?: unknown } | null;
  const network = typeof body?.network === "string" ? body.network : "";
  const address = typeof body?.address === "string" ? body.address : "";
  const r = await requestPayout(user.profile.id, { network, address });
  if (!r.ok) {
    return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, r.code === "OPEN_REQUEST" ? 409 : 422, ctx.startedAt);
  }
  await auditLogService.record({
    actorUserId: user.profile.id,
    action: "seller.payout_requested",
    targetType: "SellerPayout",
    targetId: r.payoutId,
    metadata: { amount: r.amount, network },
  });
  return ApiResponse.success({ payoutId: r.payoutId, amount: r.amount }, ctx.requestId, 201, ctx.startedAt);
});
