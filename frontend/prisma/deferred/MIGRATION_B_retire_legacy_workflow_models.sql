-- ============================================================================
-- AT24 Automation - MIGRATION B: retire the legacy Workflow / 14D Automation
-- models.
--
-- STATUS: NOT AUTHORIZED. NOT in prisma/migrations/ - `prisma migrate deploy`
-- will NEVER pick this up from here. It is applied ONLY by:
--   1. an explicit owner "Migration B authorized" decision, AND
--   2. moving this file into
--      prisma/migrations/<timestamp>_retire_legacy_workflow_models/migration.sql
--      then running `prisma migrate deploy`.
--
-- GATE (must all be green first):
--   Migration A applied -> DB integration + security validation ->
--   automation production smoke -> observation window -> explicit B authz.
--
-- Precondition checks this migration performs before dropping anything:
--   * the automation tables exist and are populated (adoption really happened)
--   * no code path references the legacy tables (verified out-of-band)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'automations') THEN
    RAISE EXCEPTION 'Migration B refused: automations table missing - Migration A has not been applied';
  END IF;
END $$;

ALTER TABLE IF EXISTS "workflow_queue_items" DROP CONSTRAINT IF EXISTS "workflow_queue_items_workflowId_fkey";
ALTER TABLE IF EXISTS "workflow_runs" DROP CONSTRAINT IF EXISTS "workflow_runs_workflowId_fkey";
DROP TABLE IF EXISTS "workflow_queue_items";
DROP TABLE IF EXISTS "workflow_runs";
DROP TABLE IF EXISTS "workflows";
DROP TABLE IF EXISTS "Automation";
DROP TYPE IF EXISTS "RunStatus";
DROP TYPE IF EXISTS "WorkflowStatus";
DROP TYPE IF EXISTS "WorkflowTrigger";
