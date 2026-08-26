// app/api/private/paper-trading/account/reset/route.ts
// Paper Trading Engine, Phase P1. Discards all open positions (0 realized
// P&L) and restores the $10,000 starting balance - see
// paper-trading.service.ts#resetAccount for why this is never a fabricated
// flat close at a fetched price.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { paperTradingService } from "@/services/paper-trading/paper-trading.service";

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const summary = await paperTradingService.resetAccount(sessionUser.profile.id);
  return ApiResponse.success({ summary }, ctx.requestId, 200, ctx.startedAt);
});
