// app/api/private/admin/users/[userId]/route.ts
// Sprint L2.6 - Phase 2: real user detail (with real usage counts) and the
// only two mutations this sprint offers: role change and status change
// (suspend/activate). Both are real Prisma writes via AdminUserService,
// both are audit-logged with the real before/after values. Admin-only.
//
// withContext's RouteHandler is (req, ctx: RequestContext) - it does not
// thread Next's dynamic route `params` through (see
// services/backend/Middleware.ts, left untouched). The id is read from the
// already-parsed request path, the same technique used by
// app/api/private/conversations/[conversationId]/route.ts.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminUserService } from "@/services/admin/AdminUserService";
import { auditLogService } from "@/services/admin/AuditLogService";

function userIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("users");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const userId = userIdFromPath(ctx.path);
  if (!userId) {
    return ApiResponse.error({ code: "VALIDATION", message: "userId must be a non-empty string" }, ctx.requestId, 400, ctx.startedAt);
  }

  const detail = await adminUserService.getUser(userId);
  if (!detail) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "User not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  return ApiResponse.success({ user: detail }, ctx.requestId, 200, ctx.startedAt);
});

export const PATCH = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const userId = userIdFromPath(ctx.path);
  if (!userId) {
    return ApiResponse.error({ code: "VALIDATION", message: "userId must be a non-empty string" }, ctx.requestId, 400, ctx.startedAt);
  }

  const before = await adminUserService.getUser(userId);
  if (!before) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "User not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as { role?: unknown; status?: unknown } | null;

  if (body?.role !== undefined) {
    if (body.role !== "user" && body.role !== "admin") {
      return ApiResponse.error({ code: "VALIDATION", message: "role must be 'user' or 'admin'" }, ctx.requestId, 400, ctx.startedAt);
    }
    await adminUserService.setRole(userId, body.role);
    await auditLogService.record({
      actorUserId: gate.user.profile.id,
      action: "user.role_changed",
      targetType: "User",
      targetId: userId,
      metadata: { before: before.role, after: body.role },
    });
  }

  if (body?.status !== undefined) {
    if (body.status !== "active" && body.status !== "suspended") {
      return ApiResponse.error({ code: "VALIDATION", message: "status must be 'active' or 'suspended'" }, ctx.requestId, 400, ctx.startedAt);
    }
    await adminUserService.setStatus(userId, body.status);
    await auditLogService.record({
      actorUserId: gate.user.profile.id,
      action: "user.status_changed",
      targetType: "User",
      targetId: userId,
      metadata: { before: before.status, after: body.status },
    });
  }

  const after = await adminUserService.getUser(userId);
  return ApiResponse.success({ user: after }, ctx.requestId, 200, ctx.startedAt);
});
