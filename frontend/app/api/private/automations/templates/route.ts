// app/api/private/automations/templates/route.ts
// AT24 Automation (MVP) - the static Beta template catalogue.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { AUTOMATION_TEMPLATES } from "@/config/automation-templates";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const items = AUTOMATION_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    overridable: t.overridable,
    definition: t.definition,
  }));
  return ApiResponse.success({ items }, ctx.requestId, 200, ctx.startedAt);
});
