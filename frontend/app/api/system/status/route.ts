// app/api/system/status/route.ts
// Sprint 14A - Backend Foundation
// Sprint 14D - Uses the async health check (real database probe).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { healthService } from "@/services/backend/HealthService";

export const GET = withContext(async (_req, ctx) => {
  const status = await healthService.getSystemStatusAsync();
  return ApiResponse.success(status, ctx.requestId, 200, ctx.startedAt);
});