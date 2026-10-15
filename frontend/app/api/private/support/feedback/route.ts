// app/api/private/support/feedback/route.ts
// AT24 Copilot Phase 4. POST { runId, value: "up" | "down" } - rate one of the caller's own SUPPORT
// answers. userId comes from the session only; a run that is not the caller's answers 404.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { recordSupportFeedback, isFeedbackValue, FeedbackNotAllowedError } from "@/services/support/feedback";

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const body = (await req.json().catch(() => null)) as { runId?: unknown; value?: unknown } | null;
  if (!body || typeof body.runId !== "string" || !body.runId) throw Errors.validation("runId is required");
  if (!isFeedbackValue(body.value)) throw Errors.validation('value must be "up" or "down"');

  try {
    const feedback = await recordSupportFeedback(sessionUser.profile.id, body.runId, body.value);
    if (!feedback) {
      return ApiResponse.error({ code: "NOT_FOUND", message: "Answer not found" }, ctx.requestId, 404, ctx.startedAt);
    }
    return ApiResponse.success({ feedback }, ctx.requestId, 200, ctx.startedAt);
  } catch (err) {
    if (err instanceof FeedbackNotAllowedError) throw Errors.validation("This answer cannot be rated");
    throw err;
  }
});
