// app/api/private/publishing/articles/[id]/publish/route.ts
// Sprint D2.3.S1 - Publishing Activation. Publish is a durable status change
// on the article row itself (website-channel scope only, confirmed with the
// user) - it never claims content was posted to Telegram/Twitter/LinkedIn/
// newsletter/RSS, since none of those have configured credentials (see
// services/ai/publishing/publisher.service.ts). Gated by the same
// validateArticle() reuse as schedule() - Publish previously did nothing at
// all (Master Audit D2.3.F, Critical finding #1).
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

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = articleIdFromPath(ctx.path);
  if (!id) throw Errors.validation("Article id is required");

  const { article, validation } = await articleService.publish(sessionUser.profile.id, id);
  if (!validation.valid) {
    return ApiResponse.error(
      { code: "VALIDATION", message: "Article is not ready to publish", details: { issues: validation.issues } },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }
  return ApiResponse.success({ article }, ctx.requestId, 200, ctx.startedAt);
});
