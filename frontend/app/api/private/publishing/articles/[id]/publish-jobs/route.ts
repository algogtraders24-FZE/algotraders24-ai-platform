// app/api/private/publishing/articles/[id]/publish-jobs/route.ts
// AT24 Publishing Engine (P2.3-F) - create / list publishing jobs for one
// Article. Thin: auth -> validate -> PublishingService -> ApiResponse. All
// lifecycle / idempotency / ownership logic is in the service.
//
//   POST -> create (or return the existing idempotent) job for a destination
//   GET  -> the caller's jobs for this Article, newest first
//
// PublishingService.createJob() resolves the Article by (id, userId) first,
// so a foreign Article is a 404 - never a leak. `userId` is the server
// session, never a request body (Sprint P2.1 §14).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { publishingService } from "@/services/publishing/publishing.service";
import {
  isPublishingDestinationId,
  PUBLISHING_DESTINATION_IDS,
  isPublishSchedule,
  validatePublishSchedule,
  type PublishSchedule,
} from "@/types/publishing";

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
  const articleId = articleIdFromPath(ctx.path);
  if (!articleId) throw Errors.validation("Article id is required");

  const body = (await req.json().catch(() => null)) as { destination?: unknown; schedule?: unknown } | null;

  // INTERNAL_BLOG is the only destination today; default to it when omitted.
  const destination = body?.destination ?? "INTERNAL_BLOG";
  if (!isPublishingDestinationId(destination)) {
    throw Errors.validation(`destination must be one of: ${PUBLISHING_DESTINATION_IDS.join(", ")}`);
  }

  // Sprint P2.4: optional schedule. Omitted => immediate. All slot times UTC.
  let schedule: PublishSchedule | undefined;
  if (body?.schedule !== undefined) {
    const check = validatePublishSchedule(body.schedule);
    if (!check.valid) {
      throw Errors.validation(check.violations.map((v) => v.message).join(" "));
    }
    schedule = isPublishSchedule(body.schedule) ? body.schedule : undefined;
  }

  const job = await publishingService.createJob({
    userId: sessionUser.profile.id,
    articleId,
    destination,
    schedule,
  });
  return ApiResponse.success({ job }, ctx.requestId, 201, ctx.startedAt);
});

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const articleId = articleIdFromPath(ctx.path);
  if (!articleId) throw Errors.validation("Article id is required");

  const jobs = await publishingService.listJobsForArticle(sessionUser.profile.id, articleId);
  return ApiResponse.success({ jobs }, ctx.requestId, 200, ctx.startedAt);
});
