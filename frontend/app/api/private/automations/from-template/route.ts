// app/api/private/automations/from-template/route.ts
// AT24 Automation (MVP) - create a real DRAFT automation from a template.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { automationService } from "@/services/automation/automation-service";

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const body = (await req.json().catch(() => null)) as
    | { templateId?: unknown; overrides?: { name?: unknown; symbol?: unknown } }
    | null;
  if (!body || typeof body.templateId !== "string") throw Errors.validation("templateId is required");

  const overrides: { name?: string; symbol?: string } = {};
  if (body.overrides && typeof body.overrides === "object") {
    if (typeof body.overrides.name === "string") overrides.name = body.overrides.name;
    if (typeof body.overrides.symbol === "string") overrides.symbol = body.overrides.symbol;
  }
  const created = await automationService.createFromTemplate(sessionUser.profile.id, body.templateId, overrides);
  return ApiResponse.success(created, ctx.requestId, 201, ctx.startedAt);
});
