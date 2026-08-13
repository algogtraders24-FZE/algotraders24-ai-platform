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

const DEFAULT_MAX_USERS = 50;
const DEFAULT_PER_USER_LIMIT = 20;

const runs = new IntelligenceAnalysisRunService();

export interface ScheduledOutcomeEvaluationUserError {
  userId: string;
  message: string;
}

export interface ScheduledOutcomeEvaluationSummary {
  usersScanned: number;
  usersProcessed: number;
  usersFailed: number;
  outcomesCreated: number;
  /** One entry per failed user. Error messages only (no stack traces, no query text) - never leaked to an unauthenticated caller, only ever returned to an already-authenticated trigger caller. */
  errors: ScheduledOutcomeEvaluationUserError[];
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
): Promise<ScheduledOutcomeEvaluationSummary> {
  const maxUsers = options.maxUsers ?? DEFAULT_MAX_USERS;
  const perUserLimit = options.perUserLimit ?? DEFAULT_PER_USER_LIMIT;

  const userIds = await runs.listUserIdsWithPendingEvaluationRuns(maxUsers);

  const summary: ScheduledOutcomeEvaluationSummary = {
    usersScanned: userIds.length,
    usersProcessed: 0,
    usersFailed: 0,
    outcomesCreated: 0,
    errors: [],
  };

  for (const userId of userIds) {
    try {
      const outcomes = await evaluatePendingAnalysisRunsForUser(userId, perUserLimit);
      summary.usersProcessed += 1;
      summary.outcomesCreated += outcomes.length;
    } catch (cause) {
      // Isolation: this user's failure is recorded, never thrown - the loop
      // continues to the next user, and no outcome is fabricated for this one.
      summary.usersFailed += 1;
      summary.errors.push({ userId, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }

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
  return evaluatePendingAnalysisRunsForUser(userId, limit);
}
