// app/api/private/algo-test/strategy-builder/route.ts
// QP-2 - Conversational Strategy Builder. POST { state, userText } ->
// compiles the accumulated intent and returns updated in-memory
// conversation state. Deliberately thin: all real logic lives in
// quant-strategy-builder.service.ts, which itself calls the EXISTING,
// unmodified compileNaturalLanguageStrategy() - this route never
// duplicates compiler logic, and never calls compileAndRunAiStrategy()
// (which would auto-backtest - explicitly out of QP-2's locked scope).
//
// QP-3 - a successful compile also gets a best-effort chart-preview
// payload attached (services/algo-test/quant-chat-preview.service.ts) -
// real candles + the strategy's own indicator overlays. Never blocks or
// fails the response: a preview failure (provider hiccup, no real
// instrument yet) simply omits `preview`, exactly like a failed compile
// already omits `run.compiledSpec`.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { hasQuantProAccess } from "@/lib/access/quant-pro";
import { Errors } from "@/services/backend/ErrorHandler";
import { applyModification } from "@/services/algo-test/quant-strategy-builder.service";
import { buildQuantChatPreview } from "@/services/algo-test/quant-chat-preview.service";
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

  // Quant Pro production launch - the real access boundary. The
  // /dashboard/quant-chat page gate is UX only; this is what actually
  // enforces it, since a client can always call this route directly.
  if (!(await hasQuantProAccess(sessionUser.profile.id))) {
    return ApiResponse.error({ code: "QUANT_PRO_REQUIRED", message: "Quant Pro is a paid feature. Upgrade your plan to use Quant Chat." }, ctx.requestId, 403, ctx.startedAt);
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

  const preview = await buildQuantChatPreview(result.run);

  return ApiResponse.success({ ...result, preview }, ctx.requestId, 200, ctx.startedAt);
});
