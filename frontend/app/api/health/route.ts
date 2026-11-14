// app/api/health/route.ts
// Public liveness probe. Deliberately minimal: it says the app is up and nothing else (no version, environment or uptime), so it is safe for
// external uptime monitors without describing the deployment.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { healthService } from "@/services/backend/HealthService";

export const GET = withContext(async (_req, ctx) => {
  const report = healthService.getHealth();
  return ApiResponse.success({ status: report.status, timestamp: report.timestamp }, ctx.requestId, 200, ctx.startedAt);
});
