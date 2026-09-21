// app/api/private/admin/support-handoffs/[id]/messages/route.ts
// AT24 Support Human Handoff MVP - D10/D12. The human-reply pathway. Every
// admin reply is attributed to the real, authenticated admin
// (gate.user.profile.id) - never anonymous, never client-supplied.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { replyAsSupportAdmin, HandoffNotFoundError } from "@/services/support/handoff-service";
import { adminHandoffIdFromPath } from "@/services/support/handoff-route-path";

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const id = adminHandoffIdFromPath(ctx.path);
  if (!id) throw Errors.validation("handoff id is required");

  const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
  if (typeof body?.content !== "string" || !body.content.trim()) {
    throw Errors.validation('A JSON body with { "content" } is required');
  }

  try {
    const detail = await replyAsSupportAdmin({ id, adminUserId: gate.user.profile.id, content: body.content.trim() });
    return ApiResponse.success({ handoff: detail }, ctx.requestId, 201, ctx.startedAt);
  } catch (err) {
    if (err instanceof HandoffNotFoundError) {
      return ApiResponse.error({ code: "NOT_FOUND", message: "Support case not found" }, ctx.requestId, 404, ctx.startedAt);
    }
    throw err;
  }
});
