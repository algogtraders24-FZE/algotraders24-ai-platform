// app/api/private/seller/identity/route.ts
// Seller identity verification (Sumsub).
//   GET  -> { status, message }
//   POST -> { url } one-time hosted verification link for the signed-in seller (or { verified: true })
// The seller id always comes from the session; the provider is told OUR user id as externalUserId, never a value the seller supplies.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getIdentity, startVerification } from "@/services/marketplace/identityStore";
import { selfServeAllowedFor, isPlatformOwner } from "@/lib/marketplace/selfServe";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  return ApiResponse.success(await getIdentity(user.profile.id), ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!selfServeAllowedFor(user.profile.email)) {
    return ApiResponse.error({ code: "SELF_SERVE_UNAVAILABLE", message: "Self-serve listing is not open for this account yet." }, ctx.requestId, 403, ctx.startedAt);
  }
  if (!user.profile.emailVerified) {
    return ApiResponse.error({ code: "SELLER_NOT_VERIFIED", message: "Please confirm your email address first." }, ctx.requestId, 403, ctx.startedAt);
  }
  const r = await startVerification({ id: user.profile.id, email: user.profile.email });
  // 422, not 502: Cloudflare replaces an origin 502 with its own "Bad gateway" page and hides our message.
  if (!r.ok) {
    const message = r.debug && isPlatformOwner(user.profile.email) ? `${r.message} [owner debug] ${r.debug}` : r.message;
    return ApiResponse.error({ code: r.code, message }, ctx.requestId, r.code === "NOT_CONFIGURED" ? 503 : 422, ctx.startedAt);
  }
  return ApiResponse.success("url" in r ? { url: r.url } : { verified: true }, ctx.requestId, 200, ctx.startedAt);
});
