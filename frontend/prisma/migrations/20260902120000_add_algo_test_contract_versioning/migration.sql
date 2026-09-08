-- P3.3 - Algo Test Productization & Strategy Registry
-- Adds strategyVersion (reproducibility - which registered version of
-- strategyId this run actually executed against), resultVersion (the
-- persisted result contract's own field-shape version), and engineVersion
-- (at24-quant-engine's own SimulationResult.provenance.runtimeVersion,
-- copied verbatim - never a duplicated literal). All three nullable: rows
-- created before this migration (P3.2B's own live-tested runs) genuinely
-- predate strategy versioning and are never backfilled with a guess.
ALTER TABLE "AlgoTestRun" ADD COLUMN "strategyVersion" TEXT;
ALTER TABLE "AlgoTestRun" ADD COLUMN "resultVersion" TEXT;
ALTER TABLE "AlgoTestRun" ADD COLUMN "engineVersion" TEXT;
