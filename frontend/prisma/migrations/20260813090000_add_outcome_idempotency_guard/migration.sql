-- Sprint D2.7.9 - Historical Validation Production Wiring. Hand-written
-- (not `prisma migrate dev`, per this repo's established convention -
-- migrate dev's shadow-DB drift check fails on the pgvector migration and
-- would demand a full reset). Purely additive: one new partial unique
-- index, no changes to any existing table/column/constraint.
--
-- Concurrency backstop for HypothesisOutcomeEvaluatorService.
-- evaluateAnalysisRun(): now that this evaluator has a real production
-- trigger (scheduled and/or admin-invoked, possibly overlapping), two
-- invocations could otherwise both read "no finalized outcome yet" for the
-- same hypothesis and both insert a finalized verdict. This index makes the
-- second insert fail at the database level - the application catches that
-- and treats it as "a concurrent run already recorded this", not an error.
--
-- Deliberately scoped to only "validated"/"invalidated" (the real,
-- sampleSize-affecting verdicts) and to non-null hypothesisId (D2.5.1's
-- no-hypothesis-snapshot outcomes always carry a null hypothesisId and are
-- guarded by application-level idempotency instead - see
-- evaluateAnalysisRun's own no-hypothesisSnapshot branch). "pending" and
-- "inconclusive" outcomes are excluded on purpose: both remain retryable
-- (a window that hasn't closed yet, or a transient provider failure,
-- deserves another real attempt on a later trigger run) and multiple rows
-- of either status are expected and harmless - neither counts toward
-- HistoricalValidationService's sampleSize denominator.

CREATE UNIQUE INDEX "intelligence_analysis_outcomes_finalized_unique"
ON "intelligence_analysis_outcomes" ("analysisRunId", "hypothesisId")
WHERE "hypothesisId" IS NOT NULL
  AND "status" IN ('validated', 'invalidated');
