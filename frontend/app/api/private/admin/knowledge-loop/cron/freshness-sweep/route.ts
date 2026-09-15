// app/api/private/admin/knowledge-loop/cron/freshness-sweep/route.ts
// Sprint K4.2-C Phase 1 — the one production trigger for the existing,
// UNMODIFIED K2 `createFreshnessSweep()` factory
// (services/knowledge-loop/knowledge/freshness-sweep.ts, untouched by this
// phase — K4.2C_PHASE1_ADMIN_GOVERNANCE.md §0). Auth = valid CRON_SECRET
// bearer (constant-time) OR an authenticated admin — the exact precedent of
// services/automation/cron-route.ts. Never a plain logged-in user.
//
// IMPORTANT: this path MUST also be listed in CRON_SECRET_EXEMPT_PATHS in
// frontend/proxy.ts and as a cron entry in frontend/vercel.json, or the
// Next 16 middleware session gate 401s the request before it reaches this
// handler (Publishing hit this exact bug twice - P2.3-E, PR #49).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { createFreshnessSweep } from "@/services/knowledge-loop/knowledge";

export const maxDuration = 60;

const handler = withContext(async (req, ctx) => {
  if (isValidCronSecret(req)) {
    const sweep = await createFreshnessSweep();
    const result = await sweep();
    return ApiResponse.success({ trigger: "cron", ...result }, ctx.requestId, 200, ctx.startedAt);
  }

  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const sweep = await createFreshnessSweep();
  const result = await sweep();
  return ApiResponse.success({ trigger: "admin-manual", ...result }, ctx.requestId, 200, ctx.startedAt);
});

export const GET = handler;
export const POST = handler;
