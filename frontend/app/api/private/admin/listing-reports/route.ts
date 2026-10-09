// app/api/private/admin/listing-reports/route.ts
// Seller self-serve Phase 5 - the owner's side of buyer reports.
//   GET   -> listings with open reports or suspended
//   PATCH { listingId, action: "restore" | "retire" }
//     restore: listing back on sale, reports dismissed
//     retire : listing removed from sale, every build revoked (existing licences stop validating), reports upheld
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { auditLogService } from "@/services/admin/AuditLogService";
import { createNotification } from "@/services/notifications/NotificationService";
import { adminReportGroups, resolveListing } from "@/services/marketplace/listingReportStore";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  return ApiResponse.success({ groups: await adminReportGroups() }, ctx.requestId, 200, ctx.startedAt);
});

export const PATCH = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => null)) as { listingId?: unknown; action?: unknown } | null;
  const listingId = typeof body?.listingId === "string" ? body.listingId : "";
  const action = body?.action === "restore" || body?.action === "retire" ? body.action : null;
  if (!listingId || !action) return ApiResponse.error({ code: "VALIDATION", message: 'listingId and action ("restore" | "retire") are required' }, ctx.requestId, 400, ctx.startedAt);
  const r = await resolveListing(listingId, action);
  if (!r.ok) return ApiResponse.error({ code: r.code ?? "FAILED", message: "Listing not found" }, ctx.requestId, 404, ctx.startedAt);
  await auditLogService.record({ actorUserId: gate.user.profile.id, action: action === "restore" ? "marketplace.report_dismissed" : "marketplace.report_upheld", targetType: "MarketplaceListing", targetId: listingId, metadata: { action } });
  if (r.sellerId) {
    await createNotification({
      userId: r.sellerId, kind: "listing_review_result", severity: action === "restore" ? "info" : "critical",
      title: action === "restore" ? `Your listing "${r.title}" is back on sale` : `Your listing "${r.title}" was removed`,
      body: action === "restore" ? "After review, the reports were dismissed." : "After review, the reports were upheld and the listing was removed from the marketplace.",
    }).catch(() => undefined);
  }
  return ApiResponse.success({ listingId, action }, ctx.requestId, 200, ctx.startedAt);
});
