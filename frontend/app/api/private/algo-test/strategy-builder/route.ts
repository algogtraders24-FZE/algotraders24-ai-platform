// app/api/private/algo-test/strategy-builder/route.ts
// QP-2 - Conversational Strategy Builder. POST { state, userText } ->
// compiles the accumulated intent and returns updated in-memory
// conversation state. Deliberately thin: all real logic lives in
// quant-strategy-builder.service.ts, which itself calls the EXISTING,
// unmodified compileNaturalLanguageStrategy() - this route never
// duplicates compiler logic, and never calls compileAndRunAiStrategy()
// (which would auto-backtest - explicitly out of QP-2's locked scope).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { applyModification } from "@/services/algo-test/quant-strategy-builder.service";
import type { QuantChatConversationState } from "@/types/quant-chat";
import { EMPTY_QUANT_CHAT_STATE } from "@/types/quant-chat";

function hasEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function isConversationState(v: unknown): v is QuantChatConversationState {
  return typeof v === "object" && v !== null && Array.isArray((v as { turns?: unknown }).turns) && typeof (v as { currentIntent?: unknown }).currentIntent === "string";
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw Errors.validation("A JSON body with userText is required");
  const { userText, state } = body as Record<string, unknown>;
  if (typeof userText !== "string" || userText.trim().length === 0) throw Errors.validation("userText must be a non-empty string");
  if (userText.length > 2000) throw Errors.validation("userText must be 2000 characters or fewer");
  if (state !== undefined && !isConversationState(state)) throw Errors.validation("state, when provided, must be a valid conversation state object");

  if (!hasEnv("ANTHROPIC_API_KEY")) {
    return ApiResponse.error({ code: "AI_PROVIDER_UNAVAILABLE", message: "The strategy builder is not configured (ANTHROPIC_API_KEY is not set)." }, ctx.requestId, 503, ctx.startedAt);
  }

  const result = await applyModification({
    userId: sessionUser.profile.id,
    state: (state as QuantChatConversationState | undefined) ?? EMPTY_QUANT_CHAT_STATE,
    userText,
  });

  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
