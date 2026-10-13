// app/api/private/rewards/withdraw/route.ts
//   GET  -> { balances, payouts, rules }
//   POST {} -> request a USDT withdrawal of the WHOLE available balance to the saved address (one open request at a time)
// Always scoped to the signed-in user. Needs an active paid Pro plan, a verified identity, and withdrawals switched on.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { rewardsOpenFor } from "@/lib/rewards/access";
import { holdDays, minPayoutCents, withdrawalsEnabled } from "@/lib/rewards/config";
import { PAYOUT_NETWORKS } from "@/lib/marketplace/earnings";
import { getBalances, listPayouts, requestWithdrawal } from "@/services/rewards/payoutStore";
import { getSavedAddress } from "@/services/rewards/addressStore";
import { addressStatusText, isAddressActive } from "@/lib/rewards/payoutAddress";

const RULES = () => ({ holdDays: holdDays(), minCents: minPayoutCents(), networks: PAYOUT_NETWORKS, method: "USDT", withdrawalsOpen: withdrawalsEnabled() });

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
  // A withdrawal is only ever sent to the member's SAVED address, and only once its cooling period is over. Anything in the request body is ignored.
  const saved = await getSavedAddress(user.profile.id);
  if (!saved) return ApiResponse.error({ code: "NO_ADDRESS", message: "Save your USDT address in your wallet first." }, ctx.requestId, 422, ctx.startedAt);
  const now = new Date();
  if (!isAddressActive(saved.activeFrom, now)) return ApiResponse.error({ code: "ADDRESS_COOLING", message: addressStatusText(saved.activeFrom, now) }, ctx.requestId, 409, ctx.startedAt);
  const r = await requestWithdrawal({ userId: user.profile.id, email: user.profile.email, network: saved.network, address: saved.address, now });
  if (!r.ok) return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, r.code === "OPEN_REQUEST" || r.code === "BALANCE_CHANGED" ? 409 : r.code === "NOT_ELIGIBLE" ? 403 : 422, ctx.startedAt);
  return ApiResponse.success({ payoutId: r.payoutId, amountCents: r.amountCents }, ctx.requestId, 201, ctx.startedAt);
});
