-- Sprint D2.5.4 - Hypothesis Outcome & Historical Validation Engine.
-- Hand-written (not `prisma migrate dev`, per this repo's established
-- convention). Purely additive: 3 new nullable columns + 2 new indexes,
-- zero changes to any existing column, type, or constraint.

ALTER TABLE "intelligence_analysis_runs"
  ADD COLUMN "hypothesisSnapshot" JSONB;

ALTER TABLE "intelligence_analysis_outcomes"
  ADD COLUMN "hypothesisType" TEXT,
  ADD COLUMN "regimeType" TEXT;

CREATE INDEX "intelligence_analysis_outcomes_hypothesisType_idx" ON "intelligence_analysis_outcomes"("hypothesisType");
CREATE INDEX "intelligence_analysis_outcomes_regimeType_idx" ON "intelligence_analysis_outcomes"("regimeType");
