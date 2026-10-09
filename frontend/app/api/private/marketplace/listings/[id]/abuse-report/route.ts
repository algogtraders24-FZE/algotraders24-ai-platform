// app/api/private/marketplace/listings/[id]/abuse-report/route.ts
// Seller self-serve Phase 5 - a buyer reports a listing they paid for.
//   GET  -> { canReport, alreadyReported }
//   POST { reason, details } -> files the report; the 3rd distinct buyer report suspends the listing automatically
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { auditLogService } from "@/services/admin/AuditLogService";
import { createNotification } from "@/services/notifications/NotificationService";
import { reportEligibility, submitReport } from "@/services/marketplace/listingReportStore";

function listingIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("listings");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.success({ canReport: false, alreadyReported: false }, ctx.requestId, 200, ctx.startedAt);
  const listingId = listingIdFromPath(ctx.path);
  if (!listingId) return ApiResponse.error({ code: "VALIDATION", message: "listing id is required" }, ctx.requestId, 400, ctx.startedAt);
  return ApiResponse.success(await reportEligibility(listingId, user.profile.id), ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const listingId = listingIdFromPath(ctx.path);
  if (!listingId) return ApiResponse.error({ code: "VALIDATION", message: "listing id is required" }, ctx.requestId, 400, ctx.startedAt);
  const body = (await req.json().catch(() => null)) as { reason?: unknown; details?: unknown } | null;

  const r = await submitReport(listingId, user.profile.id, { reason: body?.reason, details: body?.details });
  if (!r.ok) {
    const status = r.code === "NOT_FOUND" ? 404 : r.code === "ALREADY_REPORTED" ? 409 : r.code === "NOT_A_BUYER" ? 403 : 422;
    return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, status, ctx.startedAt);
  }

  await auditLogService.record({ actorUserId: user.profile.id, action: "marketplace.listing_reported", targetType: "MarketplaceListing", targetId: listingId, metadata: { reason: String(body?.reason) } });

  if (r.suspended) {
    await auditLogService.record({ actorUserId: user.profile.id, action: "marketplace.auto_suspended", targetType: "MarketplaceListing", targetId: listingId, metadata: { reporters: r.reporters } });
    // Tell the seller, and every admin (the only manual step: decide restore or retire).
    await createNotification({
      userId: r.sellerId, kind: "listing_suspended", severity: "critical", title: `Your listing "${r.title}" was suspended`,
      body: "Several buyers reported it, so it is hidden while we review. We will contact you.", href: "/marketplace/sell",
    }).catch(() => undefined);
    const admins = await prisma.user.findMany({ where: { role: "admin", deletedAt: null }, select: { id: true } }).catch(() => []);
    for (const a of admins) {
      await createNotification({
        userId: a.id, kind: "listing_suspended_admin", severity: "critical", title: `Auto-suspended: ${r.title}`,
        body: `${r.reporters} buyers reported it. Review and restore or retire it.`, href: "/dashboard/admin/listing-reports",
      }).catch(() => undefined);
    }
  }
  return ApiResponse.success({ filed: true }, ctx.requestId, 201, ctx.startedAt);
});
