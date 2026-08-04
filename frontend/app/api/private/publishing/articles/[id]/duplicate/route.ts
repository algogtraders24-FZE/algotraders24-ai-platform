// app/api/private/publishing/articles/[id]/duplicate/route.ts
// Sprint D2.3.S1 - Publishing Activation. Published articles are read-only
// (see article.service.ts's update() guard) - this is how you revise one:
// copy it into a fresh draft, edit the copy, publish that instead. Standard
// CMS pattern; avoids needing a separate version-history table while still
// guaranteeing a published row never mutates under a reader.
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

  const article = await articleService.duplicateAsDraft(sessionUser.profile.id, id);
  return ApiResponse.success({ article }, ctx.requestId, 201, ctx.startedAt);
});
