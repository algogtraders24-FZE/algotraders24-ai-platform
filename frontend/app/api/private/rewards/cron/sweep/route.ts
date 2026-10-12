// app/api/private/rewards/cron/sweep/route.ts
// The daily rewards sweep (see services/rewards/releaseService.ts). Same auth shape as the other cron routes: a valid cron
// secret OR an authenticated admin, never a plain logged-in user.
//
// NOT yet registered in vercel.json - reachable by an admin or a presented cron secret, but Vercel Cron will not call it until
// an entry is added there. A deliberate pause: it must wait for the owner's go-ahead and for the rewards migration to be applied.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { rewardsMode } from "@/lib/rewards/config";
import { runRewardsSweep } from "@/services/rewards/releaseService";

export const maxDuration = 60;

async function handle(req: Request, ctx: { requestId: string; startedAt: number }) {
  let trigger = "cron";
  if (!isValidCronSecret(req)) {
    const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
    if (!gate.ok) return gate.response;
    trigger = "admin-manual";
  }
  // While the program is off nothing can be due, but an admin may still run it by hand to check the reserve.
  if (trigger === "cron" && rewardsMode() === "off") {
    return ApiResponse.success({ trigger, skipped: "program is off" }, ctx.requestId, 200, ctx.startedAt);
  }
  const report = await runRewardsSweep();
  return ApiResponse.success({ trigger, ...report }, ctx.requestId, 200, ctx.startedAt);
}

export const GET = withContext(handle);
export const POST = withContext(handle);
