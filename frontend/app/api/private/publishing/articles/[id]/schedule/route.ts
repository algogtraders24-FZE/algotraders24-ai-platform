// app/api/private/publishing/articles/[id]/schedule/route.ts
// Sprint D2.3.S1 - Publishing Activation. Schedule is gated by
// articleService.schedule()'s reuse of the existing, previously-unwired
// validateArticle() - a thin article is rejected with its real issues[],
// never silently allowed through (Master Audit D2.3.F, Critical finding #1:
// Schedule previously did nothing at all).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { articleService } from "@/services/publishing/article.service";

function articleIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("articles");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = articleIdFromPath(ctx.path);
  if (!id) throw Errors.validation("Article id is required");

  const body = (await req.json().catch(() => null)) as { scheduledFor?: unknown } | null;
  if (typeof body?.scheduledFor !== "string") {
    throw Errors.validation("scheduledFor must be an ISO date string");
  }

  const { article, validation } = await articleService.schedule(sessionUser.profile.id, id, body.scheduledFor);
  if (!validation.valid) {
    return ApiResponse.error(
      { code: "VALIDATION", message: "Article is not ready to schedule", details: { issues: validation.issues } },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }
  return ApiResponse.success({ article }, ctx.requestId, 200, ctx.startedAt);
});
