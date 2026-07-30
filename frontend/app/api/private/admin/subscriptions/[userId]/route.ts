// app/api/private/admin/subscriptions/[userId]/route.ts
// Sprint L2.6 - Phase 3: real admin subscription mutations (cancel,
// reactivate, override-plan), each audit-logged with real before/after
// values. Admin-only. See AdminSubscriptionService for why an admin
// override (unlike the self-service L2.5 flow) may grant any plan - it is
// a real administrative action, never a fabricated payment.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminSubscriptionService, InvalidPlanError } from "@/services/admin/AdminSubscriptionService";
import { auditLogService } from "@/services/admin/AuditLogService";
import { prisma } from "@/lib/prisma";

function userIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("subscriptions");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const PATCH = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const userId = userIdFromPath(ctx.path);
  if (!userId) {
    return ApiResponse.error({ code: "VALIDATION", message: "userId must be a non-empty string" }, ctx.requestId, 400, ctx.startedAt);
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "User not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as { action?: unknown; planId?: unknown } | null;
  const action = body?.action;

  if (action !== "cancel" && action !== "reactivate" && action !== "override-plan") {
    return ApiResponse.error(
      { code: "VALIDATION", message: "action must be one of: cancel, reactivate, override-plan" },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  try {
    if (action === "cancel" || action === "reactivate") {
      const updated = await adminSubscriptionService.setCancelAtPeriodEnd(userId, action === "cancel");
      if (!updated) {
        return ApiResponse.error({ code: "NOT_FOUND", message: "No active subscription for this user" }, ctx.requestId, 404, ctx.startedAt);
      }
      await auditLogService.record({
        actorUserId: gate.user.profile.id,
        action: action === "cancel" ? "subscription.canceled" : "subscription.reactivated",
        targetType: "Subscription",
        targetId: updated.id,
        metadata: { userId },
      });
      return ApiResponse.success({ subscription: updated }, ctx.requestId, 200, ctx.startedAt);
    }

    // override-plan
    if (typeof body?.planId !== "string" || body.planId.trim().length === 0) {
      return ApiResponse.error({ code: "VALIDATION", message: "planId must be a non-empty string" }, ctx.requestId, 400, ctx.startedAt);
    }
    const before = targetUser.planId;
    const updated = await adminSubscriptionService.overridePlan(userId, body.planId);
    await auditLogService.record({
      actorUserId: gate.user.profile.id,
      action: "subscription.plan_overridden",
      targetType: "Subscription",
      targetId: updated.id,
      metadata: { userId, before, after: body.planId },
    });
    return ApiResponse.success({ subscription: updated }, ctx.requestId, 200, ctx.startedAt);
  } catch (error) {
    if (error instanceof InvalidPlanError) {
      return ApiResponse.error({ code: "VALIDATION", message: error.message }, ctx.requestId, 400, ctx.startedAt);
    }
    return ApiResponse.error({ code: "UPDATE_FAILED", message: "Could not update the subscription" }, ctx.requestId, 500, ctx.startedAt);
  }
});
