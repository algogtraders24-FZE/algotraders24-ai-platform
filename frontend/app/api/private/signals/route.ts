// app/api/private/signals/route.ts
// POST { symbol, timeframe, dir, entryType, entry, stop, target, rr, score, scoreMax, confluences, source?, signalTime, lastClose }
// -> records the trade plan the Pro Chart just generated for the signed-in user (idempotent per plan + candle), so its outcome can be measured later.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { chartSignalService, parseRecordInput } from "@/services/chart/chart-signal.service";

export const dynamic = "force-dynamic";

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const input = parseRecordInput(body);
  const result = await chartSignalService.record(user.profile.id, input);
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
