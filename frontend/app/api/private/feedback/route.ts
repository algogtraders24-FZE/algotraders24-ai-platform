// app/api/private/feedback/route.ts
// Sprint R1.2 - Phase 1: submit feedback (Bug Report / Feature Request /
// General Feedback). Any authenticated user - no role requirement. userId
// and page are both taken from the session/request server-side, never
// trusted from the body beyond type/message.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { feedbackService, isFeedbackType } from "@/services/feedback/FeedbackService";

const MAX_MESSAGE_CHARS = 2000;

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as { type?: unknown; message?: unknown; page?: unknown } | null;
  if (!isFeedbackType(body?.type)) {
    return ApiResponse.error({ code: "VALIDATION", message: "type must be one of: bug, feature, general" }, ctx.requestId, 400, ctx.startedAt);
  }
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (message.length === 0) {
    return ApiResponse.error({ code: "VALIDATION", message: "message is required" }, ctx.requestId, 400, ctx.startedAt);
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return ApiResponse.error(
      { code: "VALIDATION", message: `message exceeds the ${MAX_MESSAGE_CHARS} character limit` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }
  const page = typeof body?.page === "string" ? body.page.slice(0, 200) : "";

  const created = await feedbackService.submit({ userId: sessionUser.profile.id, type: body.type, message, page });
  return ApiResponse.success({ id: created.id }, ctx.requestId, 201, ctx.startedAt);
});
