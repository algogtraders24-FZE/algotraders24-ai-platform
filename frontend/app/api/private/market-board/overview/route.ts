// app/api/private/market-board/overview/route.ts
// Market Board overview: the heatmap rows and the correlation shift table (daily Exness candles, Exness API first, VPS bridge as backup).
//   GET -> { rows, pairs, shiftLevel, asOf, source }   (a market whose feed fails is marked unavailable; the others still load)
// Same gate and envelope as the Swing Lab routes. No database, no keys.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getBoardOverview } from "@/services/market-board/market-board.service";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const data = await getBoardOverview();
  const res = ApiResponse.success(data, ctx.requestId, 200, ctx.startedAt);
  res.headers.set("Cache-Control", "private, max-age=0, s-maxage=300, stale-while-revalidate=300");
  return res;
});
