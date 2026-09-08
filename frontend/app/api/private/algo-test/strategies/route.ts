// app/api/private/algo-test/strategies/route.ts
// P3.3 - lists the Strategy Registry's currently-available strategies
// (services/algo-test/strategy-registry.ts), each already carrying its own
// supportedSymbols/supportedTimeframes (the Capability Registry). This is
// what AlgoTestPanel.tsx now renders its Strategy/Symbol/Timeframe fields
// from, instead of hardcoded UI constants - a config the UI cannot present
// is never shown as selectable. Gated by the same auth convention as every
// other private route, even though the registry itself carries nothing
// user-specific.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { algoTestService } from "@/services/algo-test/algo-test.service";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const strategies = algoTestService.listStrategies();
  return ApiResponse.success({ strategies }, ctx.requestId, 200, ctx.startedAt);
});
