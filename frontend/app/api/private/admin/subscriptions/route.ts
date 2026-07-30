// app/api/private/admin/subscriptions/route.ts
// Sprint L2.6 - Phase 3: Subscription Management (admin view). Real,
// paginated list joining User+Subscription+Plan. Admin-only. Independent
// of services/billing/* - see AdminSubscriptionService header comment.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminSubscriptionService } from "@/services/admin/AdminSubscriptionService";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20") || 20;

  const result = await adminSubscriptionService.listSubscriptions({ page, pageSize });
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
