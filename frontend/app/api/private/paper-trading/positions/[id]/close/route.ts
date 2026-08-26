// app/api/private/paper-trading/positions/[id]/close/route.ts
// Paper Trading Engine, Phase P1. withContext's RouteHandler has no
// `params` argument, so the id is parsed from ctx.path - the same
// workaround every other dynamic private route in this codebase uses (see
// app/api/private/chart-templates/[id]/route.ts's own comment on this).
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

  const position = await paperTradingService.closePosition(sessionUser.profile.id, id);
  return ApiResponse.success({ position }, ctx.requestId, 200, ctx.startedAt);
});
