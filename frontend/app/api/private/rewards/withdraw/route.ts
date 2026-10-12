// app/api/private/rewards/withdraw/route.ts
//   GET  -> { balances, payouts, rules }
//   POST { network, address } -> request a USDT withdrawal of the WHOLE available balance (one open request at a time)
// Always scoped to the signed-in user. Needs an active paid Pro plan, a verified identity, and withdrawals switched on.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { rewardsOpenFor } from "@/lib/rewards/access";
import { HOLD_DAYS, MIN_PAYOUT_CENTS, withdrawalsEnabled } from "@/lib/rewards/config";
import { PAYOUT_NETWORKS } from "@/lib/marketplace/earnings";
import { getBalances, listPayouts, requestWithdrawal } from "@/services/rewards/payoutStore";

const RULES = () => ({ holdDays: HOLD_DAYS, minCents: MIN_PAYOUT_CENTS, networks: PAYOUT_NETWORKS, method: "USDT", withdrawalsOpen: withdrawalsEnabled() });

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!rewardsOpenFor(user.profile.email)) return ApiResponse.error({ code: "NOT_AVAILABLE", message: "Not open for your account yet." }, ctx.requestId, 403, ctx.startedAt);
  const [balances, payouts] = await Promise.all([getBalances(user.profile.id), listPayouts(user.profile.id)]);
  return ApiResponse.success({ balances, payouts, rules: RULES() }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!rewardsOpenFor(user.profile.email)) return ApiResponse.error({ code: "NOT_AVAILABLE", message: "Not open for your account yet." }, ctx.requestId, 403, ctx.startedAt);
  const body = (await req.json().catch(() => null)) as { network?: unknown; address?: unknown } | null;
  const r = await requestWithdrawal({
    userId: user.profile.id,
    email: user.profile.email,
    network: typeof body?.network === "string" ? body.network : "",
    address: typeof body?.address === "string" ? body.address : "",
  });
  if (!r.ok) return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, r.code === "OPEN_REQUEST" || r.code === "BALANCE_CHANGED" ? 409 : r.code === "NOT_ELIGIBLE" ? 403 : 422, ctx.startedAt);
  return ApiResponse.success({ payoutId: r.payoutId, amountCents: r.amountCents }, ctx.requestId, 201, ctx.startedAt);
});
