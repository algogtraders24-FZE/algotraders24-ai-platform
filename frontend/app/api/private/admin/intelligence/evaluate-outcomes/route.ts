// app/api/private/admin/intelligence/evaluate-outcomes/route.ts
// Sprint D2.7.9 - Historical Validation Production Wiring. The one
// production trigger for the D2.5.4/D2.6.5 evaluator infrastructure - see
// docs/architecture/D2.7.9-historical-validation-production-wiring-spec.md
// for the full lifecycle. Two ways in, exactly one evaluation path:
//   1. A trusted external scheduler (Vercel Cron, an external cron
//      pinger, a scheduled CI job, etc.) presents
//      `Authorization: Bearer <INTELLIGENCE_EVALUATION_CRON_SECRET>` and
//      runs the full bounded batch across every user with pending work.
//      This path never accepts a client-supplied userId - a single shared
//      secret authorizing arbitrary per-user impersonation would defeat
//      the point of scoping it to a scheduler in the first place.
//   2. An authenticated admin (requireAdmin, the same gate every other
//      /api/private/admin/* route uses) triggers the same batch manually,
//      or - support/debug only - a single user's evaluation via ?userId=.
//      A plain logged-in trader can never reach this route either way.
// Both paths call the exact same
// services/intelligence/orchestration/scheduled-outcome-evaluation
// .service.ts functions, which call the exact same, unmodified D2.5.4/
// D2.6.5 evaluator - there is exactly one evaluation implementation.
import { timingSafeEqual } from "crypto";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { loadIntelligenceEvaluationCronSecret } from "@/lib/intelligence/evaluation-env";
import {
  runScheduledOutcomeEvaluation,
  evaluateOutcomesForUser,
} from "@/services/intelligence/orchestration/scheduled-outcome-evaluation.service";

// Hard ceilings regardless of what a caller requests via query params -
// "prevent unrestricted bulk execution" (sprint brief §9). An admin/cron
// caller can ask for a smaller batch, never a larger one.
const MAX_USERS_CAP = 200;
const PER_USER_LIMIT_CAP = 100;
const DEFAULT_MAX_USERS = 50;
const DEFAULT_PER_USER_LIMIT = 20;

/** Constant-time string comparison - never a plain `===` on a secret. Unequal lengths short-circuit (a minor, accepted length leak; still far safer than naive comparison). */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isValidCronSecret(req: Request): boolean {
  const configured = loadIntelligenceEvaluationCronSecret();
  if (!configured) return false; // cron-secret auth is not configured on this deployment - never treated as "accept anyone"
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length).trim();
  if (presented.length === 0) return false;
  return safeCompare(presented, configured);
}

function clampPositiveInt(raw: string | null, fallback: number, cap: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), cap);
}

export const POST = withContext(async (req, ctx) => {
  const url = new URL(req.url);
  const maxUsers = clampPositiveInt(url.searchParams.get("maxUsers"), DEFAULT_MAX_USERS, MAX_USERS_CAP);
  const perUserLimit = clampPositiveInt(url.searchParams.get("perUserLimit"), DEFAULT_PER_USER_LIMIT, PER_USER_LIMIT_CAP);

  if (isValidCronSecret(req)) {
    const summary = await runScheduledOutcomeEvaluation({ maxUsers, perUserLimit });
    return ApiResponse.success({ trigger: "cron", ...summary }, ctx.requestId, 200, ctx.startedAt);
  }

  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const userId = url.searchParams.get("userId");
  if (userId && userId.trim().length > 0) {
    const outcomes = await evaluateOutcomesForUser(userId, perUserLimit);
    return ApiResponse.success({ trigger: "admin-manual", userId, outcomes }, ctx.requestId, 200, ctx.startedAt);
  }

  const summary = await runScheduledOutcomeEvaluation({ maxUsers, perUserLimit });
  return ApiResponse.success({ trigger: "admin-batch", ...summary }, ctx.requestId, 200, ctx.startedAt);
});
