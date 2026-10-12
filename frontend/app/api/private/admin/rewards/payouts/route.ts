// app/api/private/admin/rewards/payouts/route.ts
// Admin: GET -> open withdrawal requests (oldest first). POST { payoutId, decision: "PAID" | "REJECTED", txRef?, note? } -> decide one.
// PAID needs the USDT transaction reference and re-checks that the member is still eligible; REJECTED returns the amount to their balance.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";
import { decideWithdrawal } from "@/services/rewards/payoutStore";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const payouts = await prisma.rewardPayout.findMany({ where: { status: "REQUESTED" }, orderBy: { createdAt: "asc" }, take: 100 });
  return ApiResponse.success({ payouts }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const b = (await req.json().catch(() => null)) as { payoutId?: unknown; decision?: unknown; txRef?: unknown; note?: unknown } | null;
  if (typeof b?.payoutId !== "string" || (b.decision !== "PAID" && b.decision !== "REJECTED")) {
    return ApiResponse.error({ code: "VALIDATION", message: "payoutId and decision (PAID or REJECTED) are required." }, ctx.requestId, 400, ctx.startedAt);
  }
  const r = await decideWithdrawal({
    payoutId: b.payoutId,
    decision: b.decision,
    txRef: typeof b.txRef === "string" ? b.txRef : undefined,
    note: typeof b.note === "string" ? b.note : undefined,
    adminId: gate.user.profile.id,
  });
  if (!r.ok) return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, r.code === "NOT_FOUND" ? 404 : 409, ctx.startedAt);
  return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
});
