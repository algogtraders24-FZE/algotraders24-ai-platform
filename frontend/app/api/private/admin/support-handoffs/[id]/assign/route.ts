// app/api/private/admin/support-handoffs/[id]/assign/route.ts
// AT24 Support Human Handoff MVP - D5. No support-specific RBAC role; any
// admin may assign a case to any admin (including self - the common
// "claim" case). Omitting adminUserId in the body defaults to self-assign.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { assignSupportHandoff, HandoffNotFoundError, InvalidTransitionError } from "@/services/support/handoff-service";
import { adminHandoffIdFromPath } from "@/services/support/handoff-route-path";

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const id = adminHandoffIdFromPath(ctx.path);
  if (!id) throw Errors.validation("handoff id is required");

  const body = (await req.json().catch(() => ({}))) as { adminUserId?: unknown } | null;
  const targetAdminUserId = typeof body?.adminUserId === "string" && body.adminUserId.trim() ? body.adminUserId : gate.user.profile.id;

  try {
    const updated = await assignSupportHandoff({ id, targetAdminUserId, actingAdminUserId: gate.user.profile.id });
    return ApiResponse.success({ handoff: updated }, ctx.requestId, 200, ctx.startedAt);
  } catch (err) {
    if (err instanceof HandoffNotFoundError) {
      return ApiResponse.error({ code: "NOT_FOUND", message: "Support case not found" }, ctx.requestId, 404, ctx.startedAt);
    }
    if (err instanceof InvalidTransitionError) {
      throw Errors.conflict("This support case is already closed and cannot be assigned.");
    }
    throw err;
  }
});
