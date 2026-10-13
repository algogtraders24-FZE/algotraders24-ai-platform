// app/api/private/rewards/withdraw/code/route.ts
//   GET  -> { method: "totp" | "email" }  how this member confirms a withdrawal
//   POST -> for an "email" member, emails a one-time 6-digit code; for a "totp" member nothing is sent (they open their authenticator app)
// Always scoped to the signed-in user.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { rewardsOpenFor } from "@/lib/rewards/access";
import { CODE_TTL_MINUTES } from "@/lib/rewards/withdrawCode";
import { getTotpFactorId } from "@/services/rewards/withdrawTotp";
import { issueWithdrawCode } from "@/services/rewards/withdrawCodeStore";
import { sendWithdrawCodeEmail } from "@/services/notifications/EmailService";

async function gate(ctx: { requestId: string; startedAt: number }) {
  const user = await getUserOrNull();
  if (!user) return { fail: ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt) };
  if (!rewardsOpenFor(user.profile.email)) return { fail: ApiResponse.error({ code: "NOT_AVAILABLE", message: "Not open for your account yet." }, ctx.requestId, 403, ctx.startedAt) };
  return { user };
}

export const GET = withContext(async (_req, ctx) => {
  const g = await gate(ctx);
  if (g.fail) return g.fail;
  const factor = await getTotpFactorId();
  return ApiResponse.success({ method: factor ? "totp" : "email" }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (_req, ctx) => {
  const g = await gate(ctx);
  if (g.fail) return g.fail;
  const user = g.user!;
  if (await getTotpFactorId()) return ApiResponse.success({ method: "totp", sent: false }, ctx.requestId, 200, ctx.startedAt);
  const issued = await issueWithdrawCode(user.profile.id);
  if (!issued.ok) return ApiResponse.error({ code: issued.code, message: issued.message }, ctx.requestId, 429, ctx.startedAt);
  await sendWithdrawCodeEmail({ to: user.profile.email, recipientUserId: user.profile.id, code: issued.code, minutes: CODE_TTL_MINUTES });
  return ApiResponse.success({ method: "email", sent: true, minutes: CODE_TTL_MINUTES }, ctx.requestId, 200, ctx.startedAt);
});
