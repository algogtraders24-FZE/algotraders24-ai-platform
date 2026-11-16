// app/api/private/admin/arena-fx/route.ts
// Admin-only read of the AI Arena (forex, gold, energy, indices): contestants, decoy luck band, latest AI decisions, token use.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { getArenaFx } from "@/services/arena-fx/board.service";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  try {
    return ApiResponse.success(await getArenaFx(), ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "The AI Arena storage is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
