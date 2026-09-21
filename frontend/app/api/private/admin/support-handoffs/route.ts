// app/api/private/admin/support-handoffs/route.ts
// AT24 Support Human Handoff MVP - D12. The first internal Support Ticket
// Queue. Mirrors app/api/private/admin/feedback/route.ts's own GET shape
// exactly (page/pageSize/status filter) - the Feedback admin page's UX
// PATTERN is reused, its table and service are not touched.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { listSupportHandoffsForAdmin } from "@/services/support/handoff-service";
import type { SupportHandoffStatus } from "@/lib/generated/prisma/enums";

const VALID_STATUSES: readonly SupportHandoffStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CANCELLED"];
function isHandoffStatus(value: unknown): value is SupportHandoffStatus {
  return typeof value === "string" && (VALID_STATUSES as readonly string[]).includes(value);
}

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20") || 20;
  const statusParam = url.searchParams.get("status") ?? undefined;
  const status = isHandoffStatus(statusParam) ? statusParam : undefined;

  const result = await listSupportHandoffsForAdmin({ page, pageSize, status });
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
