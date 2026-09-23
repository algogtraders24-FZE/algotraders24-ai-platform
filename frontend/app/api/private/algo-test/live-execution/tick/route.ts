// app/api/private/algo-test/live-execution/tick/route.ts
// Live Execution (Paper) - Phase 1. See services/algo-test/live-execution/
// live-execution.service.ts's own header for the full design rationale
// (stateless, tab-resident polling, no new cron/Agent Framework tool).
// The client re-sends the SAME compiledSpec (from an earlier
// /api/private/algo-test/compile call) on every tick; this route derives
// current market data + paper-account state fresh each call and is the
// only place a paper order actually gets placed/closed for this feature.
//
// Same access boundary as /strategy-builder (Quant Pro production
// launch's own established pattern): the page itself gates on
// hasQuantProAccess as a UX convenience, this route re-checks it as the
// real authorization boundary, since client-side gating alone is never
// sufficient.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { hasQuantProAccess } from "@/lib/access/quant-pro";
import { Errors } from "@/services/backend/ErrorHandler";
import { evaluateLiveExecutionTick } from "@/services/algo-test/live-execution/live-execution.service";
import type { StrategySpec } from "at24-quant-engine";

// A structural shape check only (arrays/objects exist where expected) -
// not a re-validation of the strategy's own semantic correctness. That
// already happened once, server-side, in the /compile call that produced
// this exact JSON; this route trusts it back verbatim, the same way a
// browser tab holding form state is trusted between two calls of the
// same authenticated session. The real safety boundary is downstream:
// PaperTradingService only ever moves this user's own simulated-money
// paper account (types/paper-trading.ts's own header: "no real money, no
// live-account connectivity, never touches the real Exness/MT5 account"),
// so a malformed/adversarial spec can only affect the caller's own
// simulation, never anyone else's data or funds.
function isStrategySpecShape(v: unknown): v is StrategySpec {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    Array.isArray(s.instruments) &&
    Array.isArray(s.timeframes) &&
    Array.isArray(s.entryRules) &&
    Array.isArray(s.exitRules) &&
    typeof s.risk === "object" &&
    s.risk !== null
  );
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  if (!(await hasQuantProAccess(sessionUser.profile.id))) {
    return ApiResponse.error({ code: "QUANT_PRO_REQUIRED", message: "Quant Pro is a paid feature. Upgrade your plan to use Live Execution." }, ctx.requestId, 403, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as { spec?: unknown } | null;
  if (!body || !isStrategySpecShape(body.spec)) {
    throw Errors.validation("A JSON body with a valid, previously-compiled 'spec' (StrategySpec) is required");
  }

  const result = await evaluateLiveExecutionTick({ userId: sessionUser.profile.id, spec: body.spec });
  return ApiResponse.success({ result }, ctx.requestId, 200, ctx.startedAt);
});
