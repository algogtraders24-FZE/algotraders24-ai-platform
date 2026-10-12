// app/api/private/rewards/referral/route.ts
// POST -> { code, link }. Creates (or returns) the member's referral code. Only accounts that could actually earn from it
// (active paid Pro + verified identity, program open for them) get one.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { loadUserFacts, rewardsOpenFor } from "@/lib/rewards/access";
import { canEarnReferral } from "@/lib/rewards/eligibility";
import { referralLink } from "@/lib/rewards/referral";
import { isPlatformOwner } from "@/lib/marketplace/selfServe";
import { ensureReferralCode } from "@/services/rewards/referralStore";

export const POST = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!rewardsOpenFor(user.profile.email)) return ApiResponse.error({ code: "NOT_AVAILABLE", message: "Not open for your account yet." }, ctx.requestId, 403, ctx.startedAt);
  const facts = await loadUserFacts(user.profile.id, user.profile.email);
  if (!canEarnReferral(facts) && !isPlatformOwner(user.profile.email)) {
    return ApiResponse.error({ code: "NOT_ELIGIBLE", message: "An active paid Pro plan and a verified identity are needed for a referral link." }, ctx.requestId, 403, ctx.startedAt);
  }
  const code = await ensureReferralCode(user.profile.id);
  return ApiResponse.success({ code, link: referralLink(code, process.env.NEXT_PUBLIC_SITE_URL || undefined) }, ctx.requestId, 200, ctx.startedAt);
});
