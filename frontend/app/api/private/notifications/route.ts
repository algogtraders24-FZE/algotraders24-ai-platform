// app/api/private/notifications/route.ts
// The signed-in user's in-app notifications (header bell).
//   GET   -> newest 30 + unread count
//   POST  -> {action:"read_all"} marks everything read
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { listNotifications, markAllRead } from "@/services/notifications/NotificationService";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  try {
    return ApiResponse.success(await listNotifications(user.profile.id), ctx.requestId, 200, ctx.startedAt);
  } catch {
    // Table not created yet (migration pending) or a transient error: the bell shows its empty state.
    return ApiResponse.success({ items: [], unread: 0 }, ctx.requestId, 200, ctx.startedAt);
  }
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "read_all") return ApiResponse.error({ code: "BAD_REQUEST", message: 'action must be "read_all"' }, ctx.requestId, 400, ctx.startedAt);
  try {
    return ApiResponse.success({ marked: await markAllRead(user.profile.id) }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Notifications are not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
