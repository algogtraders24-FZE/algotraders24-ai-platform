// app/api/private/chart-templates/[id]/route.ts
// Sprint D2.7.11 Phase 4 - delete one saved chart template. withContext's
// RouteHandler has no `params` argument, so the id is parsed from
// ctx.path - the same workaround every other dynamic private route in
// this codebase uses (see app/api/private/marketplace/listings/[id]/
// route.ts's own comment on this).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { chartTemplateService } from "@/services/chart/chart-template.service";

function templateIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("chart-templates");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const DELETE = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const id = templateIdFromPath(ctx.path);
  if (!id) {
    return ApiResponse.error({ code: "VALIDATION", message: "template id is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  await chartTemplateService.delete(sessionUser.profile.id, id);
  return ApiResponse.success({ id }, ctx.requestId, 200, ctx.startedAt);
});
