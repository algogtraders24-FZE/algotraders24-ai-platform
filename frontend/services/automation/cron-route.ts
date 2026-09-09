// services/automation/cron-route.ts
// AT24 Automation (MVP) - the shared handler for the per-slot dispatch cron
// routes. Auth = valid CRON_SECRET bearer (constant-time) OR an authenticated
// admin - the exact precedent of
// app/api/private/admin/intelligence/ingest-news/route.ts. Never a plain
// logged-in user.
//
// IMPORTANT: each slot's dispatch pathname MUST also be listed in
// CRON_SECRET_EXEMPT_PATHS in frontend/proxy.ts, or the Next 16 middleware
// session gate 401s the request before it reaches this handler (Publishing
// hit this exact bug twice - P2.3-E, PR #49). config/automation-slots.ts is
// the single source of truth for those paths.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { dispatchSlot } from "./run-dispatch";
import { getSlot } from "@/config/automation-slots";

export function slotDispatchRoute(slotId: string) {
  const handler = withContext(async (req: Request, ctx: { requestId: string; startedAt: number }) => {
    if (!getSlot(slotId)) throw Errors.validation(`unknown slot "${slotId}"`);

    if (isValidCronSecret(req)) {
      const result = await dispatchSlot(slotId, new Date());
      return ApiResponse.success({ trigger: "cron", ...result }, ctx.requestId, 200, ctx.startedAt);
    }

    const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
    if (!gate.ok) return gate.response;

    const result = await dispatchSlot(slotId, new Date());
    return ApiResponse.success({ trigger: "admin-manual", ...result }, ctx.requestId, 200, ctx.startedAt);
  });
  return { GET: handler, POST: handler };
}
