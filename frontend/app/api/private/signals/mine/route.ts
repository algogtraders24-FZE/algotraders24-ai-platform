// app/api/private/signals/mine/route.ts
// GET -> the signed-in user's recorded signals (newest first) with what became of them, plus an honest summary. Resolves unfinished ones on the way.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { chartSignalService } from "@/services/chart/chart-signal.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const data = await chartSignalService.mine(user.profile.id, 30);
  return ApiResponse.success(data, ctx.requestId, 200, ctx.startedAt);
});
