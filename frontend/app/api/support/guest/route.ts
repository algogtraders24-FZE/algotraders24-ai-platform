// app/api/support/guest/route.ts
// AT24 Support - P1. The ENTIRE anonymous (guest) support surface
// (AUTONOMOUS_SUPPORT_P1_CONTRACT.md SS6/SS11/SS14).
//
// Deliberately outside /api/private - proxy.ts's matcher does not cover
// /api/support/*, so this route never reads a session, never accepts a
// userId, and calls answerGuestQuestion() only, which structurally cannot
// reach account data. Rate-limited (best-effort, in-memory - SS14.3
// disclosed interim gap) to bound abuse of the shared embedding-provider/DB
// capacity this route uses, since zero rate-limiting infrastructure existed
// in the repo before P1.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { answerGuestQuestion } from "@/services/support/guest-knowledge-query";
import { checkGuestRateLimit } from "@/services/support/guest-rate-limit";

const MAX_QUERY_LENGTH = 2000;

function clientIpFromRequest(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export const POST = withContext(async (req, ctx) => {
  const clientIp = clientIpFromRequest(req);
  if (!checkGuestRateLimit(clientIp)) {
    return ApiResponse.error(
      { code: "RATE_LIMITED", message: "Too many requests. Please wait a moment and try again." },
      ctx.requestId,
      429,
      ctx.startedAt,
    );
  }

  const body = await req.json().catch(() => null);
  const query = (body as { query?: unknown } | null)?.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    return ApiResponse.error(
      { code: "VALIDATION", message: "query is required (non-empty string)." },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return ApiResponse.error(
      { code: "VALIDATION", message: `query must be ${MAX_QUERY_LENGTH} characters or fewer.` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  const answer = await answerGuestQuestion(query);
  return ApiResponse.success(answer, ctx.requestId, 200, ctx.startedAt);
});
