// app/api/private/algo-test/compile/route.ts
// P4 - Natural Language -> Universal Strategy IR (Phase 1: compile ->
// validate -> structured review data; docs/P4-NL-STRATEGY-COMPILER.md).
// POST { intent: string } -> the compilation's own 4-stage lifecycle
// (IMPORTED/PARSED/IR_VALID/EXECUTION_VALID) plus, only if it reached
// EXECUTION_VALID, a reviewable summary of the compiled strategy. Never
// runs a backtest itself - this route's own output is what a caller
// reviews BEFORE deciding whether to run one (the existing POST
// /api/private/algo-test/runs route, unmodified this phase).
//
// No ANTHROPIC_API_KEY exists in this project yet (lib/ai/providers/
// claude.provider.ts's own header) - this route fails cleanly with a
// real, actionable error rather than a generic 500 when the key is
// absent, matching ai-presenter-orchestrator.service.ts's own established
// "check real env-var presence before construction" convention.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { ClaudeProvider } from "@/lib/ai/providers/claude.provider";
import { compileNaturalLanguageStrategy } from "@/services/algo-test/nl-strategy-compiler.service";
import { summarizeCompiledStrategy } from "@/services/algo-test/nl-strategy-compiler-summary";

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
  if (!body || typeof body !== "object") throw Errors.validation("A JSON body with 'intent' is required");
  const { intent } = body as Record<string, unknown>;
  if (typeof intent !== "string" || intent.trim().length === 0) throw Errors.validation("intent must be a non-empty string");
  if (intent.length > 2000) throw Errors.validation("intent must be 2000 characters or fewer");

  if (!hasEnv("ANTHROPIC_API_KEY")) {
    return ApiResponse.error({ code: "AI_PROVIDER_UNAVAILABLE", message: "The natural-language strategy compiler is not configured (ANTHROPIC_API_KEY is not set)." }, ctx.requestId, 503, ctx.startedAt);
  }

  const provider = new ClaudeProvider();
  const now = Date.now();
  const compilation = await compileNaturalLanguageStrategy(intent, provider, {
    strategyId: `ai-${sessionUser.profile.id}-${now}`,
    strategyVersion: "1.0.0",
    name: intent.slice(0, 80),
    strategyTimezone: "UTC",
    createdAt: now,
  });

  return ApiResponse.success({ compilation: summarizeCompiledStrategy(compilation) }, ctx.requestId, 200, ctx.startedAt);
});
