// app/api/private/admin/support-handoffs/[id]/status/route.ts
// AT24 Support Human Handoff MVP - D4, the locked lifecycle transitions.
// Every transition is validated server-side against the exact locked
// matrix (services/support/handoff-service.ts's ADMIN_TRANSITIONS) - never
// an arbitrary client-supplied status mutation (§16).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { transitionSupportHandoffAsAdmin, HandoffNotFoundError, InvalidTransitionError } from "@/services/support/handoff-service";
import { adminHandoffIdFromPath } from "@/services/support/handoff-route-path";
import type { SupportHandoffStatus } from "@/lib/generated/prisma/enums";

const VALID_STATUSES: readonly SupportHandoffStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CANCELLED"];
function isHandoffStatus(value: unknown): value is SupportHandoffStatus {
  return typeof value === "string" && (VALID_STATUSES as readonly string[]).includes(value);
}

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const id = adminHandoffIdFromPath(ctx.path);
  if (!id) throw Errors.validation("handoff id is required");

  const body = (await req.json().catch(() => null)) as { status?: unknown } | null;
  if (!isHandoffStatus(body?.status)) {
    throw Errors.validation("status must be one of: OPEN, ASSIGNED, IN_PROGRESS, RESOLVED, CANCELLED");
  }

  try {
    const updated = await transitionSupportHandoffAsAdmin({ id, toStatus: body.status, actingAdminUserId: gate.user.profile.id });
    return ApiResponse.success({ handoff: updated }, ctx.requestId, 200, ctx.startedAt);
  } catch (err) {
    if (err instanceof HandoffNotFoundError) {
      return ApiResponse.error({ code: "NOT_FOUND", message: "Support case not found" }, ctx.requestId, 404, ctx.startedAt);
    }
    if (err instanceof InvalidTransitionError) {
      throw Errors.conflict(err.message);
    }
    throw err;
  }
});
