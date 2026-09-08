// app/api/private/algo-test/ai-runs/route.ts
// P4 Phase 2 - Backtest Wiring (docs/P4-PHASE2-BACKTEST-WIRING.md). POST
// { intent, startTime, endTime, initialBalance? } -> compiles the natural-
// language request (P4 Phase 1) and, if it reaches EXECUTION_VALID, runs
// it through the EXACT SAME generic backtest path (algoTestService's own
// compileAndRunAiStrategy(), which itself calls the unmodified,
// registry-strategy-agnostic runBacktest()) - never a separate "AI
// backtester" endpoint with its own execution logic.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { algoTestService } from "@/services/algo-test/algo-test.service";
import type { AiCompileAndRunRequest } from "@/types/algo-test";

function hasEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw Errors.validation("A JSON body with intent/startTime/endTime is required");
  const { intent, startTime, endTime, initialBalance } = body as Record<string, unknown>;
  if (typeof intent !== "string" || intent.trim().length === 0) throw Errors.validation("intent must be a non-empty string");
  if (intent.length > 2000) throw Errors.validation("intent must be 2000 characters or fewer");
  if (typeof startTime !== "string" || typeof endTime !== "string") throw Errors.validation("startTime and endTime must be ISO 8601 strings");
  if (initialBalance !== undefined && typeof initialBalance !== "number") throw Errors.validation("initialBalance must be a number when provided");

  if (!hasEnv("ANTHROPIC_API_KEY")) {
    return ApiResponse.error({ code: "AI_PROVIDER_UNAVAILABLE", message: "The natural-language strategy compiler is not configured (ANTHROPIC_API_KEY is not set)." }, ctx.requestId, 503, ctx.startedAt);
  }

  const request: AiCompileAndRunRequest = { intent, startTime, endTime, ...(initialBalance !== undefined ? { initialBalance } : {}) };
  const run = await algoTestService.compileAndRunAiStrategy(sessionUser.profile.id, request);
  return ApiResponse.success({ run }, ctx.requestId, 200, ctx.startedAt);
});
