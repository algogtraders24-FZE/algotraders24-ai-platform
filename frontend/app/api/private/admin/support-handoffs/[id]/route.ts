// app/api/private/admin/support-handoffs/[id]/route.ts
// AT24 Support Human Handoff MVP - D14/D12 "Case detail". Full ticket +
// live conversation trace + evidence references + messages + audit-visible
// fields, gated by requireAdmin() alone (no per-admin ownership - D5's own
// decision, any admin may view any case).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { getSupportHandoffDetailForAdmin, HandoffNotFoundError } from "@/services/support/handoff-service";
import { adminHandoffIdFromPath } from "@/services/support/handoff-route-path";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const id = adminHandoffIdFromPath(ctx.path);
  if (!id) throw Errors.validation("handoff id is required");

  try {
    const detail = await getSupportHandoffDetailForAdmin(id);
    return ApiResponse.success({ handoff: detail }, ctx.requestId, 200, ctx.startedAt);
  } catch (err) {
    if (err instanceof HandoffNotFoundError) {
      return ApiResponse.error({ code: "NOT_FOUND", message: "Support case not found" }, ctx.requestId, 404, ctx.startedAt);
    }
    throw err;
  }
});
