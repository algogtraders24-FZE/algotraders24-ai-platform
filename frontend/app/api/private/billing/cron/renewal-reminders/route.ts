// app/api/private/billing/cron/renewal-reminders/route.ts
// B05 renewal reminder sweep. Exact same auth shape as
// app/api/private/publishing/dispatch/route.ts: a valid cron secret OR an
// authenticated admin, never a plain logged-in user.
//
// NOT yet registered in vercel.json - this route is reachable (by an admin,
// or by a manually-presented cron secret) but Vercel Cron will not invoke
// it until an entry is added there, a deliberate pause pending the owner's
// go-ahead (see this sprint's own EmailLog migration, which this route's
// dedupe depends on being applied first).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { dispatchRenewalReminders } from "@/services/billing/RenewalReminderService";

export const maxDuration = 60;

async function handleDispatch(req: Request, ctx: { requestId: string; startedAt: number }) {
  if (isValidCronSecret(req)) {
    const report = await dispatchRenewalReminders();
    return ApiResponse.success({ trigger: "cron", ...report }, ctx.requestId, 200, ctx.startedAt);
  }

  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const report = await dispatchRenewalReminders();
  return ApiResponse.success({ trigger: "admin-manual", ...report }, ctx.requestId, 200, ctx.startedAt);
}

// GET is Vercel Cron's only invocation method; POST kept for any other caller.
export const GET = withContext(handleDispatch);
export const POST = withContext(handleDispatch);
