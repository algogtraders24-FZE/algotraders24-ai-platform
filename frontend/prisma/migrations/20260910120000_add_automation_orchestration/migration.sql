-- AT24 Automation (MVP) - MIGRATION A (additive-first, owner-authorized
-- 2026-09-10). LOCKED: AUTOMATION_DECISION_LOCK.md.
--
-- ADDITIVE ONLY. This migration:
--   * creates the 8 automation enums + 5 automation tables + indexes + FKs
--   * copies each existing Sprint-14E `workflows` row into an `automations`
--     row + one v1 DRAFT `automation_definition_versions` row, preserving the
--     original steps verbatim under definition.metadata.legacySteps
--   * DOES NOT drop, alter or rename ANY pre-existing object - the legacy
--     `workflows` / `workflow_runs` / `workflow_queue_items` tables + their
--     enums and the legacy Sprint-14D `Automation` table are left fully
--     intact, as is the pgvector `KnowledgeChunk.embedding` column and all
--     unrelated production data.
--
-- The legacy-model RETIREMENT (DROP TABLE workflows/... + DROP the retired
-- enums + DROP the 14D `Automation` table) is a SEPARATE migration
-- ("Migration B") that is NOT part of this deploy and NOT yet authorized.
-- Its gate: Migration A -> DB/security validation -> production smoke ->
-- observation -> explicit Migration B authorization.
--
-- HAND-WRITTEN (not `prisma migrate dev` output - the pgvector column would
-- be dropped by a generated diff). Applied with `prisma migrate deploy`.

-- ============================================================================
-- 1. ENUMS
-- ============================================================================
CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "AutomationTriggerType" AS ENUM ('manual', 'once', 'daily', 'weekly');
CREATE TYPE "AutomationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CONDITION_HALTED', 'CANCELLED', 'CREDIT_BLOCKED');
CREATE TYPE "AutomationRunTrigger" AS ENUM ('manual', 'schedule');
CREATE TYPE "AutomationStepKind" AS ENUM ('agent_run', 'condition', 'publication_draft', 'workspace_save');
CREATE TYPE "AutomationStepRunStatus" AS ENUM ('PENDING', 'RUNNING', 'OK', 'FAILED', 'SKIPPED');
CREATE TYPE "AutomationArtifactKind" AS ENUM ('agent_result', 'research_document', 'market_intelligence', 'publication_draft_ref');

-- ============================================================================
-- 2. TABLES
-- ============================================================================
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "activeVersionId" TEXT,
    "templateId" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_definition_versions" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "slot" TEXT,
    "daysOfWeek" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "runAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "automation_definition_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "definitionVersionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "AutomationRunTrigger" NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "creditsUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" JSONB,
    "outputRef" JSONB,
    "contextSnapshot" JSONB,
    "cancelRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_step_runs" (
    "id" TEXT NOT NULL,
    "automationRunId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" "AutomationStepKind" NOT NULL,
    "status" "AutomationStepRunStatus" NOT NULL DEFAULT 'PENDING',
    "agentRunId" TEXT,
    "articleId" TEXT,
    "artifactId" TEXT,
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "reason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "creditsUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "automation_step_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_artifacts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "automationRunId" TEXT NOT NULL,
    "stepRunId" TEXT NOT NULL,
    "kind" "AutomationArtifactKind" NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "automation_artifacts_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "automations_userId_idx" ON "automations"("userId");
CREATE INDEX "automations_userId_status_idx" ON "automations"("userId", "status");
CREATE INDEX "automations_status_nextRunAt_idx" ON "automations"("status", "nextRunAt");
CREATE INDEX "automations_deletedAt_idx" ON "automations"("deletedAt");
CREATE INDEX "automation_definition_versions_automationId_idx" ON "automation_definition_versions"("automationId");
CREATE UNIQUE INDEX "automation_definition_versions_automationId_version_key" ON "automation_definition_versions"("automationId", "version");
CREATE INDEX "automation_runs_userId_createdAt_idx" ON "automation_runs"("userId", "createdAt");
CREATE INDEX "automation_runs_automationId_createdAt_idx" ON "automation_runs"("automationId", "createdAt");
CREATE INDEX "automation_runs_status_updatedAt_idx" ON "automation_runs"("status", "updatedAt");
CREATE UNIQUE INDEX "automation_runs_automationId_scheduledFor_key" ON "automation_runs"("automationId", "scheduledFor");
CREATE INDEX "automation_step_runs_automationRunId_idx" ON "automation_step_runs"("automationRunId");
CREATE INDEX "automation_step_runs_agentRunId_idx" ON "automation_step_runs"("agentRunId");
CREATE UNIQUE INDEX "automation_step_runs_automationRunId_index_key" ON "automation_step_runs"("automationRunId", "index");
CREATE INDEX "automation_artifacts_userId_createdAt_idx" ON "automation_artifacts"("userId", "createdAt");
CREATE INDEX "automation_artifacts_automationRunId_idx" ON "automation_artifacts"("automationRunId");

-- Foreign keys
ALTER TABLE "automations" ADD CONSTRAINT "automations_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "automation_definition_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "automation_definition_versions" ADD CONSTRAINT "automation_definition_versions_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_definitionVersionId_fkey" FOREIGN KEY ("definitionVersionId") REFERENCES "automation_definition_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_step_runs" ADD CONSTRAINT "automation_step_runs_automationRunId_fkey" FOREIGN KEY ("automationRunId") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 3. DATA MIGRATION: workflows (14E) -> automations + v1 definition version
-- ============================================================================
DO $$
DECLARE
  wf RECORD;
  new_version_id TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflows') THEN
    FOR wf IN SELECT * FROM "workflows" WHERE "deletedAt" IS NULL LOOP
      INSERT INTO "automations" ("id", "userId", "name", "description", "status", "timezone", "templateId", "createdAt", "updatedAt")
      VALUES (
        wf.id, wf."userId", wf.name, COALESCE(wf.description, ''),
        'DRAFT'::"AutomationStatus",       -- unmapped legacy steps -> DRAFT, never auto-active
        'Asia/Kolkata', NULL, wf."createdAt", wf."updatedAt"
      );

      new_version_id := 'admv_' || substr(md5(random()::text || wf.id), 1, 24);
      INSERT INTO "automation_definition_versions"
        ("id", "automationId", "version", "definition", "triggerType", "slot", "daysOfWeek", "runAt", "createdBy", "createdAt")
      VALUES (
        new_version_id, wf.id, 1,
        jsonb_build_object(
          'schemaVersion', 1,
          'trigger', jsonb_build_object('type', 'manual', 'timezone', 'Asia/Kolkata'),
          'steps', '[]'::jsonb,
          'metadata', jsonb_build_object(
            'migratedFrom', 'workflow-14E',
            'legacyTrigger', wf.trigger::text,
            'legacySchedule', wf.schedule,
            'legacyStatus', wf.status::text,
            'legacySteps', COALESCE(wf.steps, '[]'::jsonb)
          )
        ),
        'manual'::"AutomationTriggerType", NULL, ARRAY[]::TEXT[], NULL, wf."userId", wf."createdAt"
      );

      UPDATE "automations" SET "activeVersionId" = new_version_id WHERE "id" = wf.id;
    END LOOP;
  END IF;
END $$;

-- ============================================================================
-- Legacy-model retirement is Migration B (a separate, NOT-yet-authorized
-- migration). This migration intentionally ends here: no DROP, no ALTER, no
-- RENAME of any pre-existing object.
-- ============================================================================
