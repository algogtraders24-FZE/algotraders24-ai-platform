// app/api/private/social/cron/run/route.ts
// Social outbox pass, every 15 minutes: prepare the day's posts when due, send the approved ones. Auth = valid CRON_SECRET or an
// authenticated admin (never a plain logged-in user); the path is listed in CRON_SECRET_EXEMPT_PATHS in frontend/proxy.ts and in
// frontend/vercel.json.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { runSocial } from "@/services/social/production";

export const maxDuration = 120;

const handler = withContext(async (req: Request, ctx: { requestId: string; startedAt: number }) => {
  if (isValidCronSecret(req)) {
    return ApiResponse.success({ trigger: "cron", ...(await runSocial()) }, ctx.requestId, 200, ctx.startedAt);
  }
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  return ApiResponse.success({ trigger: "admin-manual", ...(await runSocial()) }, ctx.requestId, 200, ctx.startedAt);
});

export const GET = handler;
export const POST = handler;
