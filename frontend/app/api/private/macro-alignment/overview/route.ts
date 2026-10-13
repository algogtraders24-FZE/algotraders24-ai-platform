// app/api/private/macro-alignment/overview/route.ts
// Compact Macro Alignment for all assets (dashboard mini cards). Session-scoped;
// read-only; decision support only.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getMacroOverview, OVERVIEW_ORDER, SIGNALS_ORDER } from "@/services/macro/macro-overview";

export const maxDuration = 60;

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  // ?set=signals -> the AI Signals page's seven instruments; default = the dashboard's five.
  const set = new URL(req.url).searchParams.get("set");
  const items = await getMacroOverview(undefined, set === "signals" ? SIGNALS_ORDER : OVERVIEW_ORDER);
  return ApiResponse.success({ items }, ctx.requestId, 200, ctx.startedAt);
});
