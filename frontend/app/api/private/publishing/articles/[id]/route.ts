// app/api/private/publishing/articles/[id]/route.ts
// Sprint D2.3.S1 - Publishing Activation. Single-article read/edit/delete,
// scoped to the session user (articleService throws a 404-mapped AppError
// on any article not owned by the caller - never leaks another user's row).
//
// withContext's RouteHandler is (req, ctx: RequestContext) - it does not
// thread through Next's dynamic route `params` (see
// services/backend/Middleware.ts, shared by every private route and left
// untouched). The article id is read from the already-parsed request path,
// the same technique app/api/private/conversations/[conversationId]/route.ts
// uses.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { articleService } from "@/services/publishing/article.service";
import { CONTENT_CATEGORIES, type ContentCategory } from "@/types/content-category";
import type { ArticleSection } from "@/types/article";

function isContentCategory(value: string): value is ContentCategory {
  return (CONTENT_CATEGORIES as string[]).includes(value);
}

function isArticleSectionArray(value: unknown): value is ArticleSection[] {
  return (
    Array.isArray(value) &&
    value.every((s) => s && typeof s === "object" && typeof s.heading === "string" && typeof s.body === "string")
  );
}

function articleIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("articles");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = articleIdFromPath(ctx.path);
  if (!id) throw Errors.validation("Article id is required");

  const article = await articleService.getById(sessionUser.profile.id, id);
  return ApiResponse.success({ article }, ctx.requestId, 200, ctx.startedAt);
});

export const PATCH = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = articleIdFromPath(ctx.path);
  if (!id) throw Errors.validation("Article id is required");

  const body = (await req.json().catch(() => null)) as
    | { title?: unknown; summary?: unknown; category?: unknown; sections?: unknown; keywords?: unknown }
    | null;
  if (!body) throw Errors.validation("Request body must be a JSON object");

  if (body.title !== undefined && typeof body.title !== "string") throw Errors.validation("title must be a string");
  if (body.summary !== undefined && typeof body.summary !== "string") throw Errors.validation("summary must be a string");
  if (body.category !== undefined && (typeof body.category !== "string" || !isContentCategory(body.category))) {
    throw Errors.validation(`category must be one of: ${CONTENT_CATEGORIES.join(", ")}`);
  }
  if (body.sections !== undefined && !isArticleSectionArray(body.sections)) {
    throw Errors.validation("sections must be an array of { heading, body } strings");
  }
  if (body.keywords !== undefined && (!Array.isArray(body.keywords) || body.keywords.some((k) => typeof k !== "string"))) {
    throw Errors.validation("keywords must be an array of strings");
  }

  const article = await articleService.update(sessionUser.profile.id, id, {
    title: body.title as string | undefined,
    summary: body.summary as string | undefined,
    category: body.category as ContentCategory | undefined,
    sections: body.sections as ArticleSection[] | undefined,
    keywords: body.keywords as string[] | undefined,
  });
  return ApiResponse.success({ article }, ctx.requestId, 200, ctx.startedAt);
});

export const DELETE = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = articleIdFromPath(ctx.path);
  if (!id) throw Errors.validation("Article id is required");

  await articleService.remove(sessionUser.profile.id, id);
  return ApiResponse.success({ deleted: true }, ctx.requestId, 200, ctx.startedAt);
});
