// app/api/private/admin/feedback/route.ts
// Sprint R1.2 - Phase 1: admin review of submitted feedback. GET lists
// (paginated, filterable by status/type); PATCH transitions status only -
// mirrors the audit-logs (GET) and users (PATCH) admin routes' shape.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminFeedbackService, isFeedbackStatus } from "@/services/admin/AdminFeedbackService";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20") || 20;
  const status = url.searchParams.get("status") ?? undefined;
  const type = url.searchParams.get("type") ?? undefined;

  const result = await adminFeedbackService.list({ page, pageSize, status, type });
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});

export const PATCH = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const body = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
  if (typeof body?.id !== "string" || body.id.trim().length === 0) {
    return ApiResponse.error({ code: "VALIDATION", message: "id is required" }, ctx.requestId, 400, ctx.startedAt);
  }
  if (!isFeedbackStatus(body?.status)) {
    return ApiResponse.error({ code: "VALIDATION", message: "status must be one of: open, reviewed, resolved" }, ctx.requestId, 400, ctx.startedAt);
  }

  const updated = await adminFeedbackService.updateStatus(body.id, body.status);
  if (!updated) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Feedback not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  return ApiResponse.success({ feedback: updated }, ctx.requestId, 200, ctx.startedAt);
});
