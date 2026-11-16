// app/api/private/market-board/chart/route.ts
// Market Board chart: closed candles of one market with the Zone Pro and Divergence Pro overlays and scorecards.
//   GET ?symbol=XAUUSD&interval=15m  ->  BoardChartDto
// Exness candles (Exness API first, VPS bridge as backup), cached for 10 seconds on the server. Descriptive, not a signal.
import { after } from "next/server";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { completeHistory, getBoardChart } from "@/services/market-board/market-board.service";
import { getBoardInstrument, isBoardTimeframe } from "@/types/market-board";

export const dynamic = "force-dynamic";
// The first load of a chart pages back through up to 8000 candles; later refreshes read only the newest page.
export const maxDuration = 60;

export const GET = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const interval = url.searchParams.get("interval") ?? "15m";
  if (!getBoardInstrument(symbol)) {
    return ApiResponse.error({ code: "VALIDATION", message: "symbol must be one of the Market Board markets" }, ctx.requestId, 400, ctx.startedAt);
  }
  if (!isBoardTimeframe(interval)) {
    return ApiResponse.error({ code: "VALIDATION", message: "interval must be 15m, 1h, 4h or 1d" }, ctx.requestId, 400, ctx.startedAt);
  }
  try {
    const data = await getBoardChart(symbol, interval);
    // the first answer uses a shorter history so it comes back quickly; the older part is loaded after the response was sent
    if (!data.historyComplete) after(() => completeHistory(symbol, interval));
    return ApiResponse.success(data, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "This market is temporarily unavailable" }, ctx.requestId, 503, ctx.startedAt);
  }
});
