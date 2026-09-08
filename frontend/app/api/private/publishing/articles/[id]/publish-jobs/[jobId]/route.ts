// app/api/private/publishing/articles/[id]/publish-jobs/[jobId]/route.ts
// AT24 Publishing Engine (P2.3-F) - read one publishing job + its attempt
// history. Ownership-scoped in the service (getJob resolves by (jobId,
// userId) -> 404 for a foreign job).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { publishingService } from "@/services/publishing/publishing.service";

function segmentAfter(path: string, key: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf(key);
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const articleId = segmentAfter(ctx.path, "articles");
  const jobId = segmentAfter(ctx.path, "publish-jobs");
  if (!articleId || !jobId) throw Errors.validation("Article id and job id are required");

  const userId = sessionUser.profile.id;
  const job = await publishingService.getJob(userId, jobId);
  if (job.articleId !== articleId) throw Errors.notFound("PublishingJob");

  const attempts = await publishingService.listJobAttempts(userId, jobId);
  return ApiResponse.success({ job, attempts }, ctx.requestId, 200, ctx.startedAt);
});
