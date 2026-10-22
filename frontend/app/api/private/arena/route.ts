// app/api/private/arena/route.ts
// Signed-in users: the AT24 Arena (paper-trading experiment) - latest snapshot + live tick, sanitised on the server (see services/arena/user-view.ts).
// Read-only; paper results only. Admins get the full detail from /api/private/admin/arena.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { sanitizeForUsers, userDelayMinutes } from "@/services/arena/user-view";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  try {
    const row = await prisma.arenaSnapshot.findUnique({ where: { id: "main" } });
    if (!row) return ApiResponse.success({ snapshot: null, live: null, configured: true }, ctx.requestId, 200, ctx.startedAt);
    const full = (row.payload as { ready?: boolean } | null)?.ready === true ? (row.payload as Record<string, unknown>) : null;
    const view = sanitizeForUsers(full, (row.live as Record<string, unknown> | null) ?? null, userDelayMinutes(process.env.ARENA_USER_DELAY_MINUTES), Date.now());
    const now = Date.now();
    return ApiResponse.success(
      { snapshot: view.snapshot, receivedAt: row.receivedAt, ageSeconds: Math.round((now - row.receivedAt.getTime()) / 1000), live: view.live, liveAgeSeconds: row.liveAt ? Math.round((now - row.liveAt.getTime()) / 1000) : null, configured: true },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "The arena is not available right now." }, ctx.requestId, 503, ctx.startedAt);
  }
});
