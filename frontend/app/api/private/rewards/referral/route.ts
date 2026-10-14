// app/api/private/rewards/referral/route.ts
// POST -> { code, link }. Creates (or returns) the member's referral code. Any signed-in account gets one; earning commission on it needs an
// active paid Pro plan at the time of each sale (decided when the sale is verified), and withdrawing needs a verified identity.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { referralLink } from "@/lib/rewards/referral";
import { ensureReferralCode } from "@/services/rewards/referralStore";

export const POST = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const code = await ensureReferralCode(user.profile.id);
  return ApiResponse.success({ code, link: referralLink(code, process.env.NEXT_PUBLIC_SITE_URL || undefined) }, ctx.requestId, 200, ctx.startedAt);
});
