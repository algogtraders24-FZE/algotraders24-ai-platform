// app/api/system/status/route.ts
// Admin-only. The subsystem detail (database type, AI and payment providers, storage figures) is internal information: it used to be public,
// which handed an unauthenticated visitor a map of the stack. Uptime checks should use /api/health, which returns only "operational".
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { healthService } from "@/services/backend/HealthService";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const status = await healthService.getSystemStatusAsync();
  return ApiResponse.success(status, ctx.requestId, 200, ctx.startedAt);
});
