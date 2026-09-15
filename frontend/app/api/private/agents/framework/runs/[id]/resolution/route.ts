// app/api/private/agents/framework/runs/[id]/resolution/route.ts
// AT24 Agent Framework - P1. Record the caller's explicit resolution
// confirmation for one of their own framework runs
// (AUTONOMOUS_SUPPORT_P1_CONTRACT.md SS10/SS12/SS17).
//
//   POST { confirmed: boolean } -> writes metadata.resolutionConfirmation on
//   the caller's own run, ownership-checked exactly like the existing
//   advance/[id] route. A positive (confirmed:true) confirmation is only
//   accepted for a terminal, non-escalated, coverage!=="no-coverage" run -
//   this is the server-side half of the "Resolved must mean an explicit Yes,
//   not just an AI reply" gate (G5); the widget's own gating (only showing
//   the prompt for an eligible run) is the other half, defense in depth.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import {
  recordResolutionConfirmation,
  ResolutionNotEligibleError,
  RunNotTerminalError,
} from "@/services/agent-framework/api/agent-run-service";

function runIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("runs");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = runIdFromPath(ctx.path);
  if (!id) throw Errors.validation("run id is required");

  const body = await req.json().catch(() => null);
  const confirmed = (body as { confirmed?: unknown } | null)?.confirmed;
  if (typeof confirmed !== "boolean") {
    throw Errors.validation('a JSON body with { "confirmed": boolean } is required');
  }

  try {
    const result = await recordResolutionConfirmation(sessionUser.profile.id, id, confirmed);
    if (!result) {
      return ApiResponse.error({ code: "NOT_FOUND", message: "Agent run not found" }, ctx.requestId, 404, ctx.startedAt);
    }
    return ApiResponse.success({ run: result.observability }, ctx.requestId, 200, ctx.startedAt);
  } catch (err) {
    if (err instanceof ResolutionNotEligibleError) throw Errors.conflict(err.message);
    if (err instanceof RunNotTerminalError) throw Errors.conflict(err.message);
    throw err;
  }
});
