// app/api/private/contests/[slug]/offer/route.ts
// POST -> the signed-in entrant's personal discount payment link (the contest's % off the full product). Idempotent while the link is usable.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { claimOffer } from "@/services/contest/contestService";

function slugFromPath(path: string): string | undefined {
  const segments = path.split("?")[0]!.split("/").filter(Boolean);
  const idx = segments.indexOf("contests");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Please sign in." }, ctx.requestId, 401, ctx.startedAt);
  const slug = slugFromPath(ctx.path);
  if (!slug) return ApiResponse.error({ code: "VALIDATION", message: "slug is required" }, ctx.requestId, 400, ctx.startedAt);
  const r = await claimOffer(user.profile.id, slug);
  if (!r.ok) return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, r.code === "NOT_FOUND" ? 404 : 422, ctx.startedAt);
  return ApiResponse.success({ url: r.url, percent: r.percent, expiresAt: r.expiresAt }, ctx.requestId, 200, ctx.startedAt);
});
