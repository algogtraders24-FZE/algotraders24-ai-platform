// services/automation/route-helpers.ts
// AT24 Automation (MVP) - shared route-handler helpers. withContext's
// RouteHandler is (req, ctx) - it does not thread Next's dynamic `params`,
// so ids are read from the already-parsed path (the same technique the
// Agent Framework + Publishing routes use).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { automationService } from "./automation-service";

/** The `:id` in /api/private/automations/:id[/...] */
export function automationIdFromPath(path: string): string | undefined {
  const seg = path.split("/").filter(Boolean);
  const i = seg.indexOf("automations");
  return i >= 0 ? seg[i + 1] : undefined;
}

/** The `:id` in /api/private/automation-runs/:id[/...] */
export function automationRunIdFromPath(path: string): string | undefined {
  const seg = path.split("/").filter(Boolean);
  const i = seg.indexOf("automation-runs");
  return i >= 0 ? seg[i + 1] : undefined;
}

/** Shared POST handler for the 4 lifecycle transitions. */
export function lifecycleRoute(action: "activate" | "pause" | "resume" | "archive") {
  return withContext(async (_req, ctx) => {
    const sessionUser = await getUserOrNull();
    if (!sessionUser) {
      return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
    }
    const id = automationIdFromPath(ctx.path);
    if (!id) throw Errors.validation("automation id is required");
    const result = await automationService.transition(sessionUser.profile.id, id, action);
    return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
  });
}
