// app/api/private/chart-templates/route.ts
// Sprint D2.7.11 Phase 4 - saved chart templates. GET lists the session
// user's own templates; POST saves (upserts by name) one. Deletion is a
// separate dynamic route ([id]/route.ts) since it targets one specific
// row, not the collection. userId is always taken from the session, never
// trusted from the body, same rule every other private route follows.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { chartTemplateService } from "@/services/chart/chart-template.service";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const templates = await chartTemplateService.list(sessionUser.profile.id);
  return ApiResponse.success({ templates }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as { name?: unknown; indicatorKeys?: unknown; drawingObjects?: unknown } | null;
  if (!body || typeof body !== "object") {
    return ApiResponse.error({ code: "VALIDATION", message: "name, indicatorKeys, and drawingObjects are required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const template = await chartTemplateService.save(sessionUser.profile.id, body.name, body.indicatorKeys, body.drawingObjects);
  return ApiResponse.success({ template }, ctx.requestId, 200, ctx.startedAt);
});
