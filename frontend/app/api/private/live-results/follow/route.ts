// app/api/private/live-results/follow/route.ts
// "Watch" a public Live Results page. Session-authenticated; every query is scoped to the session user.
//   GET            the pages the member is watching, each with a fresh summary (also "since you started watching")
//   POST {slug}    start watching a PUBLIC page (idempotent, max 50)
//   DELETE ?slug=  stop watching
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { followPage, listWatching, unfollowPage } from "@/services/live-results/follow-store";
import { liveResultsEnabled } from "@/services/live-results/prisma-store";
import { LISTING_SLUG_RE } from "@/services/live-results/pages";

export const dynamic = "force-dynamic";

const unavailable = (ctx: { requestId: string; startedAt: number }) =>
  ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);

// Page slugs are "<slugified title>-<6 hex>", i.e. the same lowercase shape as listing slugs.
const validSlug = (s: unknown): s is string => typeof s === "string" && LISTING_SLUG_RE.test(s);

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!liveResultsEnabled()) return unavailable(ctx);
  try {
    return ApiResponse.success({ items: await listWatching(user.profile.id) }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!liveResultsEnabled()) return unavailable(ctx);
  const body = (await req.json().catch(() => null)) as { slug?: unknown } | null;
  if (!validSlug(body?.slug)) return ApiResponse.error({ code: "BAD_REQUEST", message: "slug is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const r = await followPage(user.profile.id, body.slug);
    if (!r.ok) return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, r.code === "LIMIT" ? 409 : 404, ctx.startedAt);
    return ApiResponse.success({ watching: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});

export const DELETE = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!liveResultsEnabled()) return unavailable(ctx);
  const slug = new URL(req.url).searchParams.get("slug");
  if (!validSlug(slug)) return ApiResponse.error({ code: "BAD_REQUEST", message: "slug is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    await unfollowPage(user.profile.id, slug);
    return ApiResponse.success({ watching: false }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});
