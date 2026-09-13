// app/api/private/automation-runs/[id]/advance/route.ts
// AT24 Automation (MVP) - drive one bounded slice of a non-terminal run
// (for a client watching a long run). Ownership-checked; a no-op once
// terminal.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { Errors } from "@/services/backend/ErrorHandler";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { automationRepository } from "@/services/automation/automation-repository";
import { dispatchAutomationRun } from "@/services/automation/dispatcher";
import { getRunDetail } from "@/services/automation/run-view";
import { isTerminalAutomationRunStatus, type AutomationRunStatus } from "@/types/automation";
import { automationRunIdFromPath } from "@/services/automation/route-helpers";

export const maxDuration = 60;

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = automationRunIdFromPath(ctx.path);
  if (!id) throw Errors.validation("run id is required");

  const owned = await automationRepository.getRunForUser(id, sessionUser.profile.id);
  if (!owned) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Automation run not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  let advanced = false;
  if (!isTerminalAutomationRunStatus(owned.status as AutomationRunStatus)) {
    await dispatchAutomationRun(id);
    advanced = true;
  }
  const run = await getRunDetail(sessionUser.profile.id, id);
  return ApiResponse.success(
    { run, terminal: isTerminalAutomationRunStatus(run.status), advanced },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
