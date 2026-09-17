// app/api/private/agents/framework/runs/route.ts
// AT24 Agent Framework - A15. The user-facing run surface for the real
// A1-A14 framework (distinct path from the legacy `agents/route.ts` CRUD
// scaffold, which stays untouched).
//
//   GET  -> the authenticated user's own framework runs, newest first
//   POST -> start a run for an agent type; creates a QUEUED run and returns
//           immediately (no execution in the request - the client polls
//           GET .../runs/:id and calls POST .../runs/:id/advance).
//
// LOCKED (owner G14): userId comes from the server session
// (sessionUser.profile.id) and is NEVER read from the request body. All
// orchestration is delegated to services/agent-framework - this route adds
// no runtime, planner or authorization logic.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import {
  startAgentRun,
  listAgentRuns,
  listRunnableAgentTypes,
  isRunnableAgentType,
  UnknownAgentTypeError,
} from "@/services/agent-framework/api/agent-run-service";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const runs = await listAgentRuns(sessionUser.profile.id, 50);
  return ApiResponse.success({ runs, types: listRunnableAgentTypes() }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw Errors.validation('A JSON body with { "agentType", "goal" } is required');
  }
  const { agentType, goal, conversationId } = body as Record<string, unknown>;
  if (typeof agentType !== "string" || !isRunnableAgentType(agentType)) {
    throw Errors.validation(
      `agentType must be one of: ${listRunnableAgentTypes().map((t) => t.type).join(", ")}`,
    );
  }
  // goal is the agent's concern (string or object); reject only clearly wrong shapes.
  if (goal !== undefined && typeof goal !== "string" && (typeof goal !== "object" || goal === null || Array.isArray(goal))) {
    throw Errors.validation("goal must be a string or a JSON object when provided");
  }
  // conversationId (Phase B, SUPPORT only): optional, loosely validated here
  // (a malformed value is just treated as "start a new conversation" by
  // startAgentRun's own normalizeConversationId - no need to duplicate that
  // logic in the route).
  if (conversationId !== undefined && typeof conversationId !== "string") {
    throw Errors.validation("conversationId must be a string when provided");
  }

  try {
    const { runId, conversationId: returnedConversationId } = await startAgentRun({
      userId: sessionUser.profile.id, // server session - never the body
      agentType,
      goal: goal ?? {},
      conversationId,
    });
    return ApiResponse.success(
      { runId, status: "queued", conversationId: returnedConversationId },
      ctx.requestId,
      202,
      ctx.startedAt,
    );
  } catch (err) {
    if (err instanceof UnknownAgentTypeError) throw Errors.validation(err.message);
    throw err;
  }
});
