// app/api/private/automations/[id]/route.ts
// AT24 Automation (MVP) - single automation detail (GET) + edit (PATCH).
// Ownership is enforced in the service (non-owner -> 404, no existence leak).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { automationService } from "@/services/automation/automation-service";
import { automationIdFromPath } from "@/services/automation/route-helpers";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = automationIdFromPath(ctx.path);
  if (!id) throw Errors.validation("automation id is required");
  const detail = await automationService.detail(sessionUser.profile.id, id);
  return ApiResponse.success(detail, ctx.requestId, 200, ctx.startedAt);
});

export const PATCH = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = automationIdFromPath(ctx.path);
  if (!id) throw Errors.validation("automation id is required");

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; description?: unknown; definition?: unknown }
    | null;
  if (!body || typeof body !== "object") throw Errors.validation("A JSON body is required");
  if (body.name !== undefined && typeof body.name !== "string") throw Errors.validation("name must be a string");
  if (body.description !== undefined && typeof body.description !== "string") throw Errors.validation("description must be a string");

  const result = await automationService.update(sessionUser.profile.id, id, {
    name: typeof body.name === "string" ? body.name : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    definition: body.definition,
  });
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
