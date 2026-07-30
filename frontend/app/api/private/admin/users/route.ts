// app/api/private/admin/users/route.ts
// Sprint L2.6 - Phase 2: User Management. Real, paginated user list from
// the database, admin-only.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminUserService } from "@/services/admin/AdminUserService";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20") || 20;
  const query = url.searchParams.get("q") ?? undefined;

  const result = await adminUserService.listUsers({ page, pageSize, query });
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
