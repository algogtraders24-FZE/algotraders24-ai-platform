// app/api/quant-lite/codegen/route.ts
// Q1.4 Part 17/18 - POST /api/quant-lite/codegen. Synchronous: validates
// the strategy spec server-side (the same authoritative validator Q0.9
// built for backtest requests - never trust client-side validation),
// rejects anything not in Quant Lite's frozen, audited feature set
// before ever invoking a generator, and returns the generated code +
// provenance directly. No filesystem paths, no shell commands, no
// user-provided template paths ever appear in the request contract.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { validateStrategySpecServerSide } from "@/services/quant-lite/backend/validateBacktestRequest";
import { runCodegen, CodegenAdapterError } from "@/services/quant-lite/backend/codegenAdapter";
import { SUPPORTED_CODEGEN_LANGUAGES } from "@/types/quant-lite-codegen";
import type { CodegenRequest } from "@/types/quant-lite-codegen";
import type { StrategySpec } from "@/types/quant-lite";

export const runtime = "nodejs";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const POST = withContext(async (req, ctx) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ApiResponse.error({ code: "INVALID_REQUEST", message: "request body must be valid JSON" }, ctx.requestId, 400, ctx.startedAt);
  }

  if (!isPlainObject(body)) {
    return ApiResponse.error({ code: "INVALID_REQUEST", message: "request body must be a JSON object" }, ctx.requestId, 400, ctx.startedAt);
  }

  const { strategy, targetLanguage } = body as Partial<CodegenRequest>;

  if (typeof targetLanguage !== "string" || !SUPPORTED_CODEGEN_LANGUAGES.includes(targetLanguage as (typeof SUPPORTED_CODEGEN_LANGUAGES)[number])) {
    return ApiResponse.error(
      { code: "UNSUPPORTED_LANGUAGE", message: `targetLanguage must be one of: ${SUPPORTED_CODEGEN_LANGUAGES.join(", ")}` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  if (!strategy) {
    return ApiResponse.error({ code: "INVALID_REQUEST", message: "strategy is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const errors = validateStrategySpecServerSide(strategy as StrategySpec);
  if (errors.length > 0) {
    return ApiResponse.error(
      { code: "INVALID_STRATEGY", message: "strategy specification failed validation - no code was generated", details: { errors } },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  try {
    const result = await runCodegen(strategy as StrategySpec, targetLanguage as (typeof SUPPORTED_CODEGEN_LANGUAGES)[number]);
    return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
  } catch (e) {
    if (e instanceof CodegenAdapterError) {
      const status = e.code === "TIMEOUT" ? 504 : e.code === "INVALID_STRATEGY" ? 400 : 500;
      return ApiResponse.error({ code: e.code, message: e.message, details: { errors: e.details ?? [] } }, ctx.requestId, status, ctx.startedAt);
    }
    return ApiResponse.error({ code: "ENGINE_ERROR", message: "code generation failed unexpectedly" }, ctx.requestId, 500, ctx.startedAt);
  }
});
