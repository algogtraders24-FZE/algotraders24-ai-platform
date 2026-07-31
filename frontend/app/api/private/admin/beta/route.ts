// app/api/private/admin/beta/route.ts
// Sprint R1.2 - Phase 4: Admin Beta Overview aggregate (real data only -
// see AdminBetaService's header for exactly which table backs each stat).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminBetaService } from "@/services/admin/AdminBetaService";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const overview = await adminBetaService.getOverview();
  return ApiResponse.success({ overview }, ctx.requestId, 200, ctx.startedAt);
});
