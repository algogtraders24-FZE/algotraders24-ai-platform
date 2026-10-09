// app/api/private/live-results/directory/route.ts
// Every signed-in user: the list of PUBLIC Live Results pages (no performance numbers, no ranking).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { listOwnerPages, listPublicDirectory, listPublicSummaries, liveResultsEnabled } from "@/services/live-results/prisma-store";
import { SUMMARY_DISCLAIMER } from "@/services/live-results/summary";
import { followedSlugs } from "@/services/live-results/follow-store";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!liveResultsEnabled()) return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  try {
    const [pages, mine, following, summaries] = await Promise.all([listPublicDirectory(), listOwnerPages(user.profile.id), followedSlugs(user.profile.id).catch(() => [] as string[]), listPublicSummaries().catch(() => [])]);
    // "mine" are the signed-in user's own pages (any visibility) so they can find them here; nothing about other users' private pages.
    return ApiResponse.success(
      { pages, summaries, disclaimer: SUMMARY_DISCLAIMER, following, mine: mine.map((p) => ({ slug: p.slug, title: p.title, visibility: p.visibility, magicFilter: p.magicFilter, showAmounts: p.showAmounts })) },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
