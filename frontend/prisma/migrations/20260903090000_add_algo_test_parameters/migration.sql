-- P3.4 - Strategy Parameters & Reproducible Configuration
-- Adds the immutable, fully-normalized parameter snapshot (every declared
-- parameter present, defaults filled in) each completed run actually
-- executed with. Nullable: pre-P3.4 rows genuinely never recorded one, and
-- a strategy with no declared parameters legitimately has nothing to
-- record - neither case is ever backfilled with a guessed value.
ALTER TABLE "AlgoTestRun" ADD COLUMN "parameters" JSONB;
