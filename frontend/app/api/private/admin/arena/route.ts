// app/api/private/admin/arena/route.ts
// Admin-only read of the AT24 Arena data pushed by the VPS bot: the latest full snapshot + the latest small live tick.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  try {
    const row = await prisma.arenaSnapshot.findUnique({ where: { id: "main" } });
    const configured = !!process.env.ARENA_INGEST_SECRET;
    const full = row && (row.payload as { ready?: boolean } | null)?.ready === true ? row.payload : null;
    if (!row) return ApiResponse.success({ snapshot: null, live: null, configured }, ctx.requestId, 200, ctx.startedAt);
    const now = Date.now();
    return ApiResponse.success(
      {
        snapshot: full,
        receivedAt: row.receivedAt,
        ageSeconds: Math.round((now - row.receivedAt.getTime()) / 1000),
        live: row.live,
        liveAgeSeconds: row.liveAt ? Math.round((now - row.liveAt.getTime()) / 1000) : null,
        configured,
      },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Arena storage is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
