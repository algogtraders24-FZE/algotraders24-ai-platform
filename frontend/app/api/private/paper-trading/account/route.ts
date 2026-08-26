// app/api/private/paper-trading/account/route.ts
// Paper Trading Engine, Phase P1. GET returns the session user's account
// summary (auto-creating a $10,000/1:100 account on first access). userId
// is always taken from the session, never trusted from a request body -
// the same rule every other private route in this codebase follows.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { paperTradingService } from "@/services/paper-trading/paper-trading.service";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const summary = await paperTradingService.getSummary(sessionUser.profile.id);
  return ApiResponse.success({ summary }, ctx.requestId, 200, ctx.startedAt);
});
