// app/api/private/rewards/payout-address/route.ts
//   GET -> the member's saved USDT address (masked) and when it becomes usable
//   PUT { network, address } -> save or change it (starts the cooling period)
// Always scoped to the signed-in user.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { rewardsOpenFor } from "@/lib/rewards/access";
import { addressStatusText, maskAddress } from "@/lib/rewards/payoutAddress";
import { getSavedAddress, saveAddress } from "@/services/rewards/addressStore";

function view(a: { network: string; address: string; activeFrom: Date } | null) {
  if (!a) return null;
  const now = new Date();
  return { network: a.network, masked: maskAddress(a.address), activeFrom: a.activeFrom.toISOString(), status: addressStatusText(a.activeFrom, now) };
}

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!rewardsOpenFor(user.profile.email)) return ApiResponse.error({ code: "NOT_AVAILABLE", message: "Not open for your account yet." }, ctx.requestId, 403, ctx.startedAt);
  return ApiResponse.success({ address: view(await getSavedAddress(user.profile.id)) }, ctx.requestId, 200, ctx.startedAt);
});

export const PUT = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!rewardsOpenFor(user.profile.email)) return ApiResponse.error({ code: "NOT_AVAILABLE", message: "Not open for your account yet." }, ctx.requestId, 403, ctx.startedAt);
  const body = (await req.json().catch(() => null)) as { network?: unknown; address?: unknown } | null;
  const r = await saveAddress({ userId: user.profile.id, network: typeof body?.network === "string" ? body.network : "", address: typeof body?.address === "string" ? body.address : "" });
  if (!r.ok) return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, 422, ctx.startedAt);
  return ApiResponse.success({ address: view(await getSavedAddress(user.profile.id)), unchanged: r.unchanged }, ctx.requestId, 200, ctx.startedAt);
});
