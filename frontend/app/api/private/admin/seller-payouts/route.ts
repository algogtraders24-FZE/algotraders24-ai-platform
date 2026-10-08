// app/api/private/admin/seller-payouts/route.ts
// Seller self-serve Phase 4 - the only admin step in the money flow: look at payout requests and confirm a transfer.
//   GET   ?status=REQUESTED|PAID|REJECTED (optional)
//   PATCH { id, action: "paid", txRef }  -> marks the payout paid (after the admin sent the USDT and has the transaction id)
//   PATCH { id, action: "reject", note } -> releases the reserved earnings back to the seller
// The platform never sends money itself: marking "paid" only records that the admin did.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { auditLogService } from "@/services/admin/AuditLogService";
import { adminListPayouts, markPayoutPaid, rejectPayout } from "@/services/marketplace/earningsStore";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  const rows = await adminListPayouts(status && ["REQUESTED", "PAID", "REJECTED"].includes(status) ? status : undefined);
  return ApiResponse.success({ payouts: rows }, ctx.requestId, 200, ctx.startedAt);
});

export const PATCH = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown; txRef?: unknown; note?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return ApiResponse.error({ code: "VALIDATION", message: "id is required" }, ctx.requestId, 400, ctx.startedAt);

  if (body?.action === "paid") {
    const r = await markPayoutPaid(id, typeof body.txRef === "string" ? body.txRef : "");
    if (!r.ok) return ApiResponse.error({ code: r.code ?? "FAILED", message: r.code === "BAD_TX_REF" ? "Enter the transaction id of the transfer you sent." : "This payout cannot be marked paid." }, ctx.requestId, 422, ctx.startedAt);
    await auditLogService.record({ actorUserId: gate.user.profile.id, action: "seller.payout_paid", targetType: "SellerPayout", targetId: id, metadata: { txRef: String(body.txRef).slice(0, 200) } });
    return ApiResponse.success({ id, status: "PAID" }, ctx.requestId, 200, ctx.startedAt);
  }
  if (body?.action === "reject") {
    const r = await rejectPayout(id, typeof body.note === "string" ? body.note : "");
    if (!r.ok) return ApiResponse.error({ code: r.code ?? "FAILED", message: "This payout cannot be rejected." }, ctx.requestId, 422, ctx.startedAt);
    await auditLogService.record({ actorUserId: gate.user.profile.id, action: "seller.payout_rejected", targetType: "SellerPayout", targetId: id, metadata: {} });
    return ApiResponse.success({ id, status: "REJECTED" }, ctx.requestId, 200, ctx.startedAt);
  }
  return ApiResponse.error({ code: "VALIDATION", message: 'action must be "paid" or "reject"' }, ctx.requestId, 400, ctx.startedAt);
});
