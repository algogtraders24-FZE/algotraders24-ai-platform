// app/api/private/admin/signals/route.ts
// GET -> platform-wide scoreboard of recorded Pro Chart signals (admin only): overall + per symbol summary and the latest signals.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { chartSignalService } from "@/services/chart/chart-signal.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const data = await chartSignalService.platform();
  return ApiResponse.success(data, ctx.requestId, 200, ctx.startedAt);
});
