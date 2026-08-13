// services/intelligence/orchestration/scheduled-outcome-evaluation.service.ts
// Sprint D2.7.9 - Historical Validation Production Wiring.
//
// D2.7.8 found that services/intelligence/hypothesis/hypothesis-outcome-
// evaluator.service.ts (D2.5.4) and its per-user wrapper
// evaluatePendingAnalysisRunsForUser (pending-outcome-evaluation.service.ts,
// D2.6.5) were deliberately built as callable seams for "a future cron/
// route" that was never added - so IntelligenceAnalysisOutcome.sampleSize
// could never organically grow past 0 in production. This file is that
// seam's first real caller. It does NOT reimplement or replace the
// evaluator - it only adds the one thing that was missing: enumerating
// WHICH users have work pending, then calling the exact same
// evaluatePendingAnalysisRunsForUser() the seam always exposed, once per
// user, with per-user failure isolation.
//
// Bounded by design (section 11/12 of the sprint brief): at most `maxUsers`
// distinct users per invocation, at most `perUserLimit` runs per user
// (matches HypothesisOutcomeEvaluatorService's own default) - never an
// unbounded scan. One user's failure (provider outage, DB hiccup, malformed
// analysis data) is caught and recorded, never allowed to abort the rest of
// the batch or to be converted into a fabricated validated/invalidated
// verdict for that user.
import { evaluatePendingAnalysisRunsForUser } from "@/services/intelligence/orchestration/pending-outcome-evaluation.service";
import { IntelligenceAnalysisRunService } from "@/services/intelligence/memory/analysis-run.service";
import { logger } from "@/services/backend/Logger";

const DEFAULT_MAX_USERS = 50;
const DEFAULT_PER_USER_LIMIT = 20;

const runs = new IntelligenceAnalysisRunService();
// Sprint D2.7.10 - existing logging convention (services/backend/Logger.ts),
// no new logging framework introduced. Never logs secrets/auth headers -
// only ids, counts, and error messages.
const log = logger.child("intelligence-scheduler");

export interface ScheduledOutcomeEvaluationUserError {
  userId: string;
  message: string;
}

export interface ScheduledOutcomeEvaluationSummary {
  usersScanned: number;
  usersProcessed: number;
  usersFailed: number;
  /** Total pending IntelligenceAnalysisRun rows found across all scanned users, before filtering to hypothesis-bearing/eligible ones - the raw scope of work this invocation looked at. */
  runsConsidered: number;
  /** Total outcome rows returned this invocation (freshly persisted + reused-already-finalized) - never includes a still-pending, not-yet-due hypothesis (see D2.7.9's evaluateAnalysisRun, which persists no row for those). */
  outcomesCreated: number;
  validatedCount: number;
  invalidatedCount: number;
  inconclusiveCount: number;
  /** One entry per failed user. Error messages only (no stack traces, no query text) - never leaked to an unauthenticated caller, only ever returned to an already-authenticated trigger caller. */
  errors: ScheduledOutcomeEvaluationUserError[];
  durationMs: number;
}

/**
 * The production batch entry point. Enumerates up to `maxUsers` distinct
 * users with at least one pending IntelligenceAnalysisRun, then evaluates
 * each user's pending runs (up to `perUserLimit` each) via the existing,
 * unmodified evaluatePendingAnalysisRunsForUser() - the same function a
 * manual single-user trigger uses (see evaluateOutcomesForUser below) -
 * so there is exactly one evaluation code path, never two.
 */
export async function runScheduledOutcomeEvaluation(
  options: { maxUsers?: number; perUserLimit?: number } = {},
  /** Sprint D2.7.10 - who invoked this ("cron" | "admin-batch" | ...), for observability only - never changes evaluation behavior. */
  triggerSource = "unspecified",
): Promise<ScheduledOutcomeEvaluationSummary> {
  const startedAt = Date.now();
  const maxUsers = options.maxUsers ?? DEFAULT_MAX_USERS;
  const perUserLimit = options.perUserLimit ?? DEFAULT_PER_USER_LIMIT;

  const userIds = await runs.listUserIdsWithPendingEvaluationRuns(maxUsers);
  log.info("scheduler invocation started", { triggerSource, usersScanned: userIds.length, maxUsers, perUserLimit });

  const summary: ScheduledOutcomeEvaluationSummary = {
    usersScanned: userIds.length,
    usersProcessed: 0,
    usersFailed: 0,
    runsConsidered: 0,
    outcomesCreated: 0,
    validatedCount: 0,
    invalidatedCount: 0,
    inconclusiveCount: 0,
    errors: [],
    durationMs: 0,
  };

  for (const userId of userIds) {
    try {
      // Read-only, purely for observability (§16) - the evaluator itself
      // (unmodified) re-derives its own eligible subset internally.
      const pendingForUser = await runs.listPendingEvaluationRuns(userId, perUserLimit);
      summary.runsConsidered += pendingForUser.length;

      const outcomes = await evaluatePendingAnalysisRunsForUser(userId, perUserLimit);
      summary.usersProcessed += 1;
      summary.outcomesCreated += outcomes.length;
      for (const outcome of outcomes) {
        if (outcome.status === "validated") summary.validatedCount += 1;
        else if (outcome.status === "invalidated") summary.invalidatedCount += 1;
        else if (outcome.status === "inconclusive") summary.inconclusiveCount += 1;
      }
    } catch (cause) {
      // Isolation: this user's failure is recorded, never thrown - the loop
      // continues to the next user, and no outcome is fabricated for this one.
      const message = cause instanceof Error ? cause.message : String(cause);
      summary.usersFailed += 1;
      summary.errors.push({ userId, message });
      log.error("scheduler user evaluation failed", { triggerSource, userId, message });
    }
  }

  summary.durationMs = Date.now() - startedAt;
  log.info("scheduler invocation completed", {
    triggerSource,
    usersScanned: summary.usersScanned,
    usersProcessed: summary.usersProcessed,
    usersFailed: summary.usersFailed,
    runsConsidered: summary.runsConsidered,
    outcomesCreated: summary.outcomesCreated,
    validatedCount: summary.validatedCount,
    invalidatedCount: summary.invalidatedCount,
    inconclusiveCount: summary.inconclusiveCount,
    durationMs: summary.durationMs,
  });
  return summary;
}

/**
 * Manual single-user evaluation, for the admin-authenticated path of the
 * production trigger route (support/debug: evaluate one specific user's
 * pending runs on demand). Calls the exact same
 * evaluatePendingAnalysisRunsForUser() as the batch path above - not a
 * second implementation.
 */
export async function evaluateOutcomesForUser(userId: string, limit = DEFAULT_PER_USER_LIMIT) {
  const startedAt = Date.now();
  log.info("admin-manual invocation started", { triggerSource: "admin-manual", userId, limit });
  const outcomes = await evaluatePendingAnalysisRunsForUser(userId, limit);
  log.info("admin-manual invocation completed", {
    triggerSource: "admin-manual",
    userId,
    outcomesCreated: outcomes.length,
    durationMs: Date.now() - startedAt,
  });
  return outcomes;
}
