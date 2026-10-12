// app/api/private/admin/rewards/slots/route.ts
// Admin: GET ?month=YYYY-MM -> live slot counts. POST { month, productKey, limit, opened } -> open/close a month for a product.
// The whole month can never hold more than the program maximum (10 contracts).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";
import { isRewardProductKey } from "@/lib/rewards/config";
import { isMonthKey, monthKey } from "@/lib/rewards/slots";
import { adminSetSlot, slotSummary } from "@/services/rewards/slotStore";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const q = new URL(req.url).searchParams.get("month");
  const month = isMonthKey(q) ? q : monthKey(new Date());
  return ApiResponse.success(await slotSummary(month), ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const b = (await req.json().catch(() => null)) as { month?: unknown; productKey?: unknown; limit?: unknown; opened?: unknown } | null;
  if (!isMonthKey(b?.month) || !isRewardProductKey(b?.productKey) || typeof b?.limit !== "number" || typeof b?.opened !== "boolean") {
    return ApiResponse.error({ code: "VALIDATION", message: "month (YYYY-MM), productKey, limit (number) and opened (boolean) are required." }, ctx.requestId, 400, ctx.startedAt);
  }
  const r = await adminSetSlot({ month: b.month, productKey: b.productKey, limit: b.limit, opened: b.opened });
  if (!r.ok) return ApiResponse.error({ code: "INVALID_LIMIT", message: r.message }, ctx.requestId, 422, ctx.startedAt);
  await prisma.rewardAuditEvent.create({
    data: { actor: gate.user.profile.id, action: "slot.set", subjectType: "RewardSlotMonth", subjectId: `${b.month}:${b.productKey}`, data: { limit: b.limit, opened: b.opened } },
  });
  return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
});
