// app/api/private/admin/intelligence/evaluate-outcomes/route.ts
// Sprint D2.7.9 - Historical Validation Production Wiring. The one
// production trigger for the D2.5.4/D2.6.5 evaluator infrastructure - see
// docs/architecture/D2.7.9-historical-validation-production-wiring-spec.md
// for the full lifecycle. Two ways in, exactly one evaluation path:
//   1. A trusted external scheduler (Vercel Cron, an external cron
//      pinger, a scheduled CI job, etc.) presents
//      `Authorization: Bearer <cron secret>` and runs the full bounded
//      batch across every user with pending work. This path never accepts
//      a client-supplied userId, maxUsers, or perUserLimit - a scheduler
//      invocation must be deterministic and repeatable (D2.7.10 §10), and
//      a single shared secret authorizing arbitrary per-user impersonation
//      or an inflated batch size would defeat the point of scoping it to a
//      scheduler in the first place.
//   2. An authenticated admin (requireAdmin, the same gate every other
//      /api/private/admin/* route uses) triggers the same batch manually,
//      or - support/debug only - a single user's evaluation via ?userId=.
//      A plain logged-in trader can never reach this route either way.
// Both paths call the exact same
// services/intelligence/orchestration/scheduled-outcome-evaluation
// .service.ts functions, which call the exact same, unmodified D2.5.4/
// D2.6.5 evaluator - there is exactly one evaluation implementation.
//
// Sprint D2.7.10 - Historical Validation Automatic Scheduler. Vercel Cron
// always invokes via HTTP GET against the production deployment only
// (https://vercel.com/docs/cron-jobs#how-cron-jobs-work) - it never sends
// POST, and it never targets Preview/local deployments. GET is added here
// as a second export sharing the exact same handler as the existing POST -
// the admin-authenticated manual trigger (documented as POST since D2.7.9)
// keeps working unchanged; nothing about D2.7.9's behavior is removed.
// `maxDuration` is set to Vercel's own Hobby-plan ceiling (300s under
// fluid compute, the default) so a real batch has its full available
// budget - if the platform ever kills the function mid-batch, that's safe
// by construction: every outcome already persisted stays persisted (see
// D2.7.9's idempotency), and whatever wasn't reached yet stays "pending"
// for the next scheduled run.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import {
  runScheduledOutcomeEvaluation,
  evaluateOutcomesForUser,
} from "@/services/intelligence/orchestration/scheduled-outcome-evaluation.service";

// Hard ceilings regardless of what a caller requests via query params -
// "prevent unrestricted bulk execution" (D2.7.9 sprint brief §9). An
// admin/cron caller can ask for a smaller batch, never a larger one.
const MAX_USERS_CAP = 200;
const PER_USER_LIMIT_CAP = 100;
const DEFAULT_MAX_USERS = 50;
const DEFAULT_PER_USER_LIMIT = 20;

export const maxDuration = 300;

function clampPositiveInt(raw: string | null, fallback: number, cap: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), cap);
}

async function handleEvaluationTrigger(req: Request, ctx: { requestId: string; startedAt: number }) {
  const url = new URL(req.url);

  if (isValidCronSecret(req)) {
    // Deterministic and repeatable (D2.7.10 §10): the cron-authenticated
    // path always uses the fixed production defaults, never caller-
    // supplied query overrides - Vercel's own cron invocation never
    // appends query params to the configured `path` anyway, but this
    // removes even the theoretical surface for a leaked secret to request
    // an inflated batch.
    const summary = await runScheduledOutcomeEvaluation({ maxUsers: DEFAULT_MAX_USERS, perUserLimit: DEFAULT_PER_USER_LIMIT }, "cron");
    return ApiResponse.success({ trigger: "cron", ...summary }, ctx.requestId, 200, ctx.startedAt);
  }

  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const maxUsers = clampPositiveInt(url.searchParams.get("maxUsers"), DEFAULT_MAX_USERS, MAX_USERS_CAP);
  const perUserLimit = clampPositiveInt(url.searchParams.get("perUserLimit"), DEFAULT_PER_USER_LIMIT, PER_USER_LIMIT_CAP);

  const userId = url.searchParams.get("userId");
  if (userId && userId.trim().length > 0) {
    const outcomes = await evaluateOutcomesForUser(userId, perUserLimit);
    return ApiResponse.success({ trigger: "admin-manual", userId, outcomes }, ctx.requestId, 200, ctx.startedAt);
  }

  const summary = await runScheduledOutcomeEvaluation({ maxUsers, perUserLimit }, "admin-batch");
  return ApiResponse.success({ trigger: "admin-batch", ...summary }, ctx.requestId, 200, ctx.startedAt);
}

/** Vercel Cron's only supported invocation method. Also reachable manually (e.g. a browser visit while signed in as admin) since it shares the exact same handler as POST. */
export const GET = withContext(handleEvaluationTrigger);
/** Preserved from D2.7.9 for any existing non-Vercel caller (external scheduler, manual curl/admin tooling) already configured to POST here. */
export const POST = withContext(handleEvaluationTrigger);
