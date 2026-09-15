// app/api/support/session/route.ts
// AT24 Support - P1. UX-only auth-state probe for the support widget
// (AUTONOMOUS_SUPPORT_P1_CONTRACT.md SS7).
//
// NON-AUTHORITATIVE: this route decides which UI/code path the widget TRIES
// (guest vs authenticated). It grants nothing - the authenticated support
// path (/api/private/agents/framework/runs) independently re-verifies the
// real session via proxy.ts + getUserOrNull, regardless of what this probe
// returns. Deliberately outside /api/private (guest-reachable, never 401s,
// not in proxy.ts's matcher - SS4/SS23 OQ-4) and returns no PII -
// `authenticated` only.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  return ApiResponse.success({ authenticated: sessionUser !== null }, ctx.requestId, 200, ctx.startedAt);
});
