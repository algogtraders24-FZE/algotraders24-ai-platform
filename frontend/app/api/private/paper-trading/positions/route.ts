// app/api/private/paper-trading/positions/route.ts
// Paper Trading Engine, Phase P1. GET lists the account's positions
// (already returned inline by /account too - this route exists for a
// future dedicated positions/history view); POST opens a market order.
// Market order only in Phase P1 - see paper-trading.service.ts's own
// header for the real fill/margin rules (limit orders are Phase P2).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { paperTradingService } from "@/services/paper-trading/paper-trading.service";
import { Errors } from "@/services/backend/ErrorHandler";
import type { PaperPositionSide } from "@/types/paper-trading";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const summary = await paperTradingService.getSummary(sessionUser.profile.id);
  return ApiResponse.success({ positions: summary.positions }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw Errors.validation("A JSON body with symbol/side/quantity is required");
  }
  const { symbol, side, quantity } = body as Record<string, unknown>;
  if (typeof symbol !== "string" || symbol.trim().length === 0) throw Errors.validation("symbol is required");
  if (side !== "buy" && side !== "sell") throw Errors.validation("side must be 'buy' or 'sell'");
  if (typeof quantity !== "number") throw Errors.validation("quantity must be a number");

  const position = await paperTradingService.openPosition(sessionUser.profile.id, {
    symbol,
    side: side as PaperPositionSide,
    quantity,
  });
  return ApiResponse.success({ position }, ctx.requestId, 201, ctx.startedAt);
});
