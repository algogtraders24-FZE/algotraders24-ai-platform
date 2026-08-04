// app/api/private/publishing/articles/route.ts
// Sprint D2.3.S1 - Publishing Activation. Real, per-user article list +
// draft creation. Replaces the Publishing dashboard's hardcoded mockArticles
// (Master Audit D2.3.F, Critical finding #1).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { articleService } from "@/services/publishing/article.service";
import { CONTENT_CATEGORIES, type ContentCategory } from "@/types/content-category";

function isContentCategory(value: string): value is ContentCategory {
  return (CONTENT_CATEGORIES as string[]).includes(value);
}

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const articles = await articleService.list(sessionUser.profile.id);
  return ApiResponse.success({ articles }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as
    | { category?: unknown; keywords?: unknown; aiOverviewText?: unknown }
    | null;

  if (!body || typeof body.category !== "string" || !isContentCategory(body.category)) {
    throw Errors.validation(`category must be one of: ${CONTENT_CATEGORIES.join(", ")}`);
  }
  if (!Array.isArray(body.keywords) || body.keywords.some((k) => typeof k !== "string")) {
    throw Errors.validation("keywords must be an array of strings");
  }
  if (body.aiOverviewText !== undefined && typeof body.aiOverviewText !== "string") {
    throw Errors.validation("aiOverviewText must be a string when provided");
  }

  const article = await articleService.createDraft(sessionUser.profile.id, {
    category: body.category,
    keywords: body.keywords as string[],
    aiOverviewText: body.aiOverviewText as string | undefined,
  });
  return ApiResponse.success({ article }, ctx.requestId, 201, ctx.startedAt);
});
