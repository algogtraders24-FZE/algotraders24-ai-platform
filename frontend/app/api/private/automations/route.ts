// app/api/private/automations/route.ts
// AT24 Automation (MVP) - the caller's automation list + create.
//
// LOCKED (AUTOMATION_API_CONTRACT.md): userId is ALWAYS the server session
// (sessionUser.profile.id), never a body value. This route adds no
// scheduling / execution / validation logic - it delegates to
// services/automation/automation-service.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { automationService } from "@/services/automation/automation-service";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1" || url.searchParams.get("status") === "archived";
  const items = await automationService.list(sessionUser.profile.id, { includeArchived });
  return ApiResponse.success({ items, total: items.length }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; description?: unknown; definition?: unknown; timezone?: unknown }
    | null;
  if (!body || typeof body !== "object") throw Errors.validation("A JSON body is required");
  if (typeof body.name !== "string" || body.name.trim().length === 0) throw Errors.validation("name is required");
  if (body.description !== undefined && typeof body.description !== "string") throw Errors.validation("description must be a string");
  if (body.definition === undefined) throw Errors.validation("definition is required");

  const created = await automationService.create({
    userId: sessionUser.profile.id,
    name: body.name,
    description: typeof body.description === "string" ? body.description : undefined,
    accountTimezone: typeof body.timezone === "string" ? body.timezone : undefined,
    definition: body.definition,
  });
  return ApiResponse.success(created, ctx.requestId, 201, ctx.startedAt);
});
