// app/api/private/crypto-flow/scoreboard/route.ts
// Forward scoreboard of the Flow Zones (rules in services/crypto-flow/scoreboard.ts, fixed before any result existed).
//   GET -> { rows (per instrument and side), pooled, open, done, since }
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getFlowZoneScoreboard } from "@/services/crypto-flow/scoreboard.service";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const result = await getFlowZoneScoreboard();
  const res = ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
  res.headers.set("Cache-Control", "private, max-age=0, s-maxage=60, stale-while-revalidate=120");
  return res;
});
