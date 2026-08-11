-- Sprint D2.6.9 - Verified Intelligence Audit, Explainability & Answer
-- Traceability. Hand-written (not `prisma migrate dev`, per this repo's
-- established convention). Purely additive: one new table, zero changes
-- to any existing table/column/constraint.

CREATE TABLE "intelligence_audit_traces" (
    "id"                        TEXT NOT NULL,
    "userId"                    TEXT NOT NULL,
    "conversationId"            TEXT,
    "analysisRunId"             TEXT,
    "symbol"                    TEXT NOT NULL,
    "timeframe"                 TEXT NOT NULL,
    "queryType"                 TEXT NOT NULL,
    "completeness"              TEXT NOT NULL,
    "decisionState"             TEXT NOT NULL,
    "generatedAt"               TIMESTAMP(3) NOT NULL,
    "intelligenceEngineVersion" TEXT NOT NULL,
    "pipelineVersion"           TEXT NOT NULL,
    "marketData"                JSONB NOT NULL,
    "envelopeSnapshot"          JSONB NOT NULL,
    "decisionContextSnapshot"   JSONB NOT NULL,
    "relevanceBasis"            JSONB NOT NULL,
    "missingContext"            JSONB NOT NULL,
    "presenterTrace"            JSONB NOT NULL,
    "integrityResult"           JSONB NOT NULL,
    "claimTrace"                JSONB NOT NULL,
    "responseGeneratedAt"       TIMESTAMP(3) NOT NULL,
    "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version"                   TEXT NOT NULL,

    CONSTRAINT "intelligence_audit_traces_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "intelligence_audit_traces_userId_idx" ON "intelligence_audit_traces"("userId");
CREATE INDEX "intelligence_audit_traces_conversationId_idx" ON "intelligence_audit_traces"("conversationId");
CREATE INDEX "intelligence_audit_traces_analysisRunId_idx" ON "intelligence_audit_traces"("analysisRunId");
CREATE INDEX "intelligence_audit_traces_createdAt_idx" ON "intelligence_audit_traces"("createdAt");
