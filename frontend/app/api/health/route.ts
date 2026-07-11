// app/api/health/route.ts
// Sprint 14A — Backend Foundation

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { healthService } from "@/services/backend/HealthService";

export const GET = withContext(async (_req, ctx) => {
  const report = healthService.getHealth();
  return ApiResponse.success(report, ctx.requestId, 200, ctx.startedAt);
});
