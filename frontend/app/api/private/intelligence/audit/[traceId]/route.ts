// app/api/private/intelligence/audit/[traceId]/route.ts
// Sprint D2.6.9 - Verified Intelligence Audit, Explainability & Answer
// Traceability. Read-only, ownership-enforced access to one immutable
// IntelligenceAuditTrace (services/intelligence/audit/audit-trace
// .service.ts) - makes it possible for a future UI to answer "why am I
// seeing this?" without this route ever recomputing market intelligence
// or calling an LLM itself. Never returns a secret (none are ever
// stored - see types/intelligence-audit-trace.ts's header).
//
// Same architectural boundary as every other private route in this
// program: this file never imports a 15D/D2.5 internal engine or a
// market-data provider directly - AuditTraceService is the only new
// coupling point, and it only reads an already-persisted, immutable row.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { AuditTraceService } from "@/services/intelligence/audit/audit-trace.service";

const auditTraceService = new AuditTraceService();

// withContext's RouteHandler does not thread Next's dynamic route
// `params` - the trace id is read from the already-parsed request path,
// the same technique app/api/private/conversations/[conversationId]/
// route.ts already established (left untouched, so this is a local copy
// rather than a shared import, matching that file's own precedent).
function traceIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("audit");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const userId = sessionUser.profile.id;

  const traceId = traceIdFromPath(ctx.path);
  if (!traceId) {
    return ApiResponse.error({ code: "VALIDATION", message: "traceId must be a non-empty string" }, ctx.requestId, 400, ctx.startedAt);
  }

  const trace = await auditTraceService.getTrace(traceId, userId);
  if (!trace) {
    // A foreign trace and a genuinely nonexistent one are indistinguishable -
    // never a distinct forbidden response that could leak existence.
    return ApiResponse.error({ code: "NOT_FOUND", message: "Audit trace not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  return ApiResponse.success({ trace }, ctx.requestId, 200, ctx.startedAt);
});
