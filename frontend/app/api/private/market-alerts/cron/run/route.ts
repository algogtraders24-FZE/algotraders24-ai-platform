// app/api/private/market-alerts/cron/run/route.ts
// AT24 market alerts - the every-5-minutes evaluator. Auth = valid CRON_SECRET or an authenticated admin (never a
// plain logged-in user); the path is listed in CRON_SECRET_EXEMPT_PATHS in frontend/proxy.ts and in frontend/vercel.json.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { runMarketAlerts } from "@/services/market-alerts/production";

export const maxDuration = 120;

const handler = withContext(async (req: Request, ctx: { requestId: string; startedAt: number }) => {
  if (isValidCronSecret(req)) {
    const result = await runMarketAlerts(new Date());
    return ApiResponse.success({ trigger: "cron", ...result }, ctx.requestId, 200, ctx.startedAt);
  }
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const result = await runMarketAlerts(new Date());
  return ApiResponse.success({ trigger: "admin-manual", ...result }, ctx.requestId, 200, ctx.startedAt);
});

export const GET = handler;
export const POST = handler;
