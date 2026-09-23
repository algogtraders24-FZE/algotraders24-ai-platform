// app/api/private/admin/payment-links/[id]/route.ts
// Shareable Payment Links - admin revoke. Immediately blocks new checkouts
// through the link (resolvePaymentLink/recordPaymentLinkUse both check
// status === "ACTIVE") - existing completed purchases are untouched, this
// only stops the link itself from being used again.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { revokePaymentLink } from "@/services/marketplace/paymentLinkService";

function idFromPath(reqPath: string): string | undefined {
  const segments = reqPath.split("/").filter(Boolean);
  const idx = segments.indexOf("payment-links");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const PATCH = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const id = idFromPath(ctx.path);
  if (!id) {
    return ApiResponse.error({ code: "VALIDATION", message: "payment link id is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "revoke") {
    return ApiResponse.error({ code: "VALIDATION", message: 'action must be "revoke"' }, ctx.requestId, 400, ctx.startedAt);
  }

  const revoked = await revokePaymentLink(id);
  if (!revoked) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Payment link not found or already revoked" }, ctx.requestId, 404, ctx.startedAt);
  }

  return ApiResponse.success({ id, status: "REVOKED" }, ctx.requestId, 200, ctx.startedAt);
});
