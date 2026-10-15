// app/api/private/support/ask/route.ts
// AT24 Copilot - Phase 2 (AT24_COPILOT_SUPPORT_RND.md W1b). ONE request per question:
// starts the SUPPORT run and drives it to its terminal state server-side, streaming progress as
// newline-delimited JSON, instead of the browser making 5-6 sequential create/read/advance calls.
// Same engine as before: startAgentRun + advanceAgentRun (A1-A15 runtime, Phase A generation,
// the AI_ESCALATION policy hook), only the driver moved from the browser to the server.
//
// Events: {type:"accepted"} -> {type:"stage", label} per step -> {type:"done", run, conversationId,
// handoff} | {type:"error", message}. userId comes from the session only, never the body.
import { NextResponse } from "next/server";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { startAgentRun, advanceAgentRun } from "@/services/agent-framework/api/agent-run-service";
import { getActiveHandoffForUserConversation } from "@/services/support/handoff-service";
import { supportStageLabel } from "@/services/support/stage-labels";

export const maxDuration = 60;

const MAX_QUESTION_CHARS = 2000;
const MAX_ADVANCES = 12;
const encoder = new TextEncoder();

function ndjson(event: Record<string, unknown>): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = await req.json().catch(() => null);
  const question = (body as { question?: unknown } | null)?.question;
  const conversationId = (body as { conversationId?: unknown } | null)?.conversationId;
  if (typeof question !== "string" || question.trim().length === 0) {
    throw Errors.validation("question is required (non-empty string)");
  }
  if (question.length > MAX_QUESTION_CHARS) {
    throw Errors.validation(`question must be ${MAX_QUESTION_CHARS} characters or fewer`);
  }
  if (conversationId !== undefined && typeof conversationId !== "string") {
    throw Errors.validation("conversationId must be a string when provided");
  }

  const userId = sessionUser.profile.id;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(ndjson(event));
      try {
        const started = await startAgentRun({
          userId,
          agentType: "SUPPORT",
          goal: { question: question.trim() },
          conversationId,
        });
        send({ type: "accepted", runId: started.runId, conversationId: started.conversationId });

        let announced = 0;
        for (let i = 0; i < MAX_ADVANCES; i++) {
          const result = await advanceAgentRun(userId, started.runId);
          if (!result) throw new Error("run not found");

          const timeline = result.observability.timeline;
          for (const item of timeline) {
            if (item.index >= announced) {
              send({ type: "stage", label: supportStageLabel(item), index: item.index, kind: item.kind });
              announced = item.index + 1;
            }
          }

          if (result.terminal) {
            const handoff = started.conversationId
              ? await getActiveHandoffForUserConversation(userId, started.conversationId).catch(() => null)
              : null;
            send({ type: "done", run: result.observability, runId: started.runId, conversationId: started.conversationId, handoff });
            return;
          }
        }
        send({ type: "error", message: "This is taking longer than expected. Please try again." });
      } catch (err) {
        console.error("[support-ask] failed", err);
        send({ type: "error", message: "Something went wrong while answering. Please try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Request-Id": ctx.requestId,
    },
  });
});
