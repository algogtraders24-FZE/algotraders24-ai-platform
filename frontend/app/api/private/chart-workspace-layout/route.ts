// app/api/private/chart-workspace-layout/route.ts
// Sprint D2.7.11 (post-completion, roadmap item 2) - durable tiled-layout
// persistence. GET returns the session user's saved workspace layout; PUT
// replaces the whole state (never a per-field PATCH - see
// chart-workspace-layout.service.ts's own header comment for why). userId
// is always taken from the session, never trusted from the request body,
// the same rule every other private route in this codebase follows.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { chartWorkspaceLayoutService } from "@/services/chart/chart-workspace-layout.service";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const state = await chartWorkspaceLayoutService.get(sessionUser.profile.id);
  return ApiResponse.success({ state }, ctx.requestId, 200, ctx.startedAt);
});

export const PUT = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return ApiResponse.error({ code: "VALIDATION", message: "A state object is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const state = await chartWorkspaceLayoutService.save(sessionUser.profile.id, body);
  return ApiResponse.success({ state }, ctx.requestId, 200, ctx.startedAt);
});
