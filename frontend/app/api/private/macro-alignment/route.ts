// app/api/private/macro-alignment/route.ts
// AT24 Macro Alignment: the live, rule-based agreement of the macro drivers for
// one asset (?asset=gold|eurusd|usdjpy|btcusd|oil, default gold). Session-scoped;
// read-only; decision support only.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getMacroAlignmentSnapshot } from "@/services/macro/macro-service";
import { isAssetId } from "@/services/macro/macro-alignment";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const raw = new URL(req.url).searchParams.get("asset") ?? "gold";
  if (!isAssetId(raw)) {
    return ApiResponse.error({ code: "VALIDATION_ERROR", message: "Unknown asset" }, ctx.requestId, 400, ctx.startedAt);
  }
  const snapshot = await getMacroAlignmentSnapshot(raw);
  return ApiResponse.success(snapshot, ctx.requestId, 200, ctx.startedAt);
});
