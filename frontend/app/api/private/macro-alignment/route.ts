// app/api/private/macro-alignment/route.ts
// AT24 Macro Alignment (gold): the live, rule-based agreement of the macro
// drivers. Session-scoped; read-only; decision support only.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getMacroAlignmentSnapshot } from "@/services/macro/macro-service";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const snapshot = await getMacroAlignmentSnapshot();
  return ApiResponse.success(snapshot, ctx.requestId, 200, ctx.startedAt);
});
