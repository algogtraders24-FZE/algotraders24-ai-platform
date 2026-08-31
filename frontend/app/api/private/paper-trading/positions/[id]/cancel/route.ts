// app/api/private/paper-trading/positions/[id]/cancel/route.ts
// Paper Trading Engine, Phase P2. Withdraws a pending limit order that
// hasn't filled yet - see paper-trading.service.ts's own
// cancelPendingOrder() for why this is a distinct action from close
// (which requires a real market fill). withContext's RouteHandler has no
// `params` argument, so the id is parsed from ctx.path - the same
// workaround the sibling close/route.ts already uses.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { paperTradingService } from "@/services/paper-trading/paper-trading.service";
import { Errors } from "@/services/backend/ErrorHandler";

function positionIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("positions");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const id = positionIdFromPath(ctx.path);
  if (!id) throw Errors.validation("position id is required");

  const position = await paperTradingService.cancelPendingOrder(sessionUser.profile.id, id);
  return ApiResponse.success({ position }, ctx.requestId, 200, ctx.startedAt);
});
