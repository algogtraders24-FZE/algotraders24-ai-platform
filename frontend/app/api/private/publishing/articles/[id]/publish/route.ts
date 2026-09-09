// app/api/private/publishing/articles/[id]/publish/route.ts
// Sprint D2.3.S1 - "Publish now" for an Article (the dashboard button).
//
// Sprint P2.5 - REWIRED through the Publishing Engine. This route used to
// flip `Article.status = "published"` directly with no PublishingJob; after
// P2.5 that made an Article a reader-invisible dead end (/blog requires a
// SUCCEEDED INTERNAL_BLOG job). It now delegates to
// publishingService.publishArticleNow(), which keeps the existing
// validateArticle() pre-gate, creates a real job and runs it immediately -
// so the Article actually appears on /blog. The Article -> `published`
// transition still happens, but inside the job's commitSuccess transaction
// (drift-safe), not here.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { publishingService } from "@/services/publishing/publishing.service";

export const maxDuration = 60;

function articleIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("articles");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = articleIdFromPath(ctx.path);
  if (!id) throw Errors.validation("Article id is required");

  const { job } = await publishingService.publishArticleNow(sessionUser.profile.id, id);
  return ApiResponse.success({ job }, ctx.requestId, 200, ctx.startedAt);
});
