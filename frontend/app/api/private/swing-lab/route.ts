// app/api/private/swing-lab/route.ts
// Swing Lab read API: the multi-timeframe trend and key-level map for the Crypto Flow markets (public Binance bars).
//   GET -> { rows: [...], asOf }   (an instrument whose feed fails is marked unavailable; the others still load)
// Same gate and envelope as the Crypto Flow routes. No database, no keys.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getSwingMapOverview } from "@/services/swing-lab/swing-lab.service";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const data = await getSwingMapOverview();
  const res = ApiResponse.success(data, ctx.requestId, 200, ctx.startedAt);
  res.headers.set("Cache-Control", "private, max-age=0, s-maxage=300, stale-while-revalidate=300");
  return res;
});
