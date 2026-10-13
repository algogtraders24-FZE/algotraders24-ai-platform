// app/api/private/macro-alignment/overview/route.ts
// Compact Macro Alignment for all assets (dashboard mini cards). Session-scoped;
// read-only; decision support only.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getMacroOverview, attachSmc, OVERVIEW_ORDER, SIGNALS_ORDER } from "@/services/macro/macro-overview";
import { getSmcAnalysis, summariseSmc } from "@/services/smc/smc-service";

export const maxDuration = 60;

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  // ?set=signals -> the AI Signals page's seven instruments; default = the dashboard's five.
  const set = new URL(req.url).searchParams.get("set");
  const signals = set === "signals";
  const base = await getMacroOverview(undefined, signals ? SIGNALS_ORDER : OVERVIEW_ORDER);
  // The Signals page already shows the SMC lean from the intelligence overview; only the dashboard cards need it here.
  const items = signals ? base : await attachSmc(base, async (symbol) => {
    const analysis = await getSmcAnalysis(symbol);
    return analysis ? summariseSmc(analysis) : null;
  });
  return ApiResponse.success({ items }, ctx.requestId, 200, ctx.startedAt);
});
