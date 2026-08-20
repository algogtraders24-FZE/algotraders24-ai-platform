// app/api/private/chart-drawings/route.ts
// Sprint D2.7.11 Phase 1b - durable chart drawn-object persistence. GET
// returns the session user's saved objects for one symbol+timeframe; PUT
// replaces the whole set for that same key (never a per-object CRUD
// endpoint - see chart-drawing.service.ts's own header comment for why).
// userId is always taken from the session, never trusted from the query
// string or body, same rule every other private route in this codebase
// follows.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { chartDrawingService } from "@/services/chart/chart-drawing.service";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol");
  const timeframe = url.searchParams.get("timeframe");
  if (!symbol || !timeframe) {
    return ApiResponse.error({ code: "VALIDATION", message: "symbol and timeframe query params are required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const objects = await chartDrawingService.get(sessionUser.profile.id, symbol, timeframe);
  return ApiResponse.success({ objects }, ctx.requestId, 200, ctx.startedAt);
});

export const PUT = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as { symbol?: unknown; timeframe?: unknown; objects?: unknown } | null;
  if (!body || typeof body !== "object" || typeof body.symbol !== "string" || typeof body.timeframe !== "string") {
    return ApiResponse.error({ code: "VALIDATION", message: "symbol, timeframe, and objects are required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const objects = await chartDrawingService.save(sessionUser.profile.id, body.symbol, body.timeframe, body.objects);
  return ApiResponse.success({ objects }, ctx.requestId, 200, ctx.startedAt);
});
