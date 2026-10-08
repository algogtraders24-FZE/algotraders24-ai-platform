// app/api/private/admin/live-results/route.ts
// Admin: every Live Results page of every user (moderation). Admin-only via requireAdmin.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminListAll } from "@/services/live-results/prisma-store";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  try {
    return ApiResponse.success({ pages: await adminListAll() }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
