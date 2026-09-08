-- Sprint K1 -- AT24 AI Assistant Knowledge Loop: Knowledge Foundation.
--
-- GENERATED via `prisma migrate diff` (offline, schema-to-schema, no DB)
-- and hand-reviewed line by line against the LOCKED contracts:
--   docs/architecture/K1_DECISION.md (INV-1, migration gate)
--   docs/architecture/KNOWLEDGE_CONTRACT.md
--   docs/architecture/KNOWLEDGE_RETRIEVAL_CONTRACT.md
--   docs/architecture/AI_ASSISTANT_ORCHESTRATION_CONTRACT.md
--
-- STATUS: NOT APPLIED. Application requires an explicit K1-F owner go-ahead
-- and is then run via `prisma migrate deploy`.
-- Never run `prisma migrate dev` against this database (pgvector-reset trap --
-- project_sprint15c_workflow; the pgvector column on the chunk table, issue
-- #28867, is invisible to Prisma and the shadow-DB drift check would demand a
-- full reset).
--
-- Every statement below is one of: CREATE TYPE, CREATE TABLE, CREATE INDEX,
-- or ALTER TABLE ... ADD COLUMN. Reviewer-verified absent:
--   * destructive DDL, column retyping, row mutation, table truncation
--   * any reference to the chunk table or its pgvector column
--   * any foreign-key constraint on an existing table
-- The three added columns on "Knowledge" that are NOT NULL each carry a
-- constant default (scope, version, visibility), so existing rows need no
-- backfill and there is no table rewrite. The existing "Knowledge.status"
-- column is left exactly as-is; the Knowledge Loop lifecycle lives on the
-- new nullable "lifecycleStatus" column so legacy scope=user rows are
-- unaffected (KNOWLEDGE_CONTRACT section 4.3).
--
-- Content: 7 new enum types, 21 additive columns on "Knowledge", 5 new
-- tables (KnowledgeCandidate, KnowledgeAnswerProvenance, KnowledgeRetrievalLog,
-- KnowledgeAnswerCache, KnowledgeVersionCounter), 19 new indexes.

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('draft', 'active', 'deprecated', 'archived');

-- CreateEnum
CREATE TYPE "KnowledgeScope" AS ENUM ('user', 'assistant', 'support', 'shared');

-- CreateEnum
CREATE TYPE "KnowledgeVisibility" AS ENUM ('public', 'customer', 'admin', 'internal');

-- CreateEnum
CREATE TYPE "KnowledgeType" AS ENUM ('product', 'platform', 'trading_education', 'policy', 'support', 'faq');

-- CreateEnum
CREATE TYPE "KnowledgeFreshnessClass" AS ENUM ('STATIC', 'PERIODIC', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('verified_qa', 'unanswered_question', 'assistant_correction', 'web_researched', 'admin_authored', 'support_resolution', 'existing_documentation');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('candidate', 'under_review', 'approved', 'rejected', 'duplicate', 'superseded');

-- AlterTable
ALTER TABLE "Knowledge" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "canonicalAnswer" TEXT,
ADD COLUMN     "canonicalQuestion" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "deprecatedAt" TIMESTAMP(3),
ADD COLUMN     "deprecatedBy" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "freshnessClass" "KnowledgeFreshnessClass",
ADD COLUMN     "freshnessReviewEveryDays" INTEGER,
ADD COLUMN     "knowledgeType" "KnowledgeType",
ADD COLUMN     "lastRetrievedAt" TIMESTAMP(3),
ADD COLUMN     "lastReviewedAt" TIMESTAMP(3),
ADD COLUMN     "lifecycleStatus" "KnowledgeStatus",
ADD COLUMN     "provenance" JSONB,
ADD COLUMN     "scope" "KnowledgeScope" NOT NULL DEFAULT 'user',
ADD COLUMN     "sourceType" "KnowledgeSourceType",
ADD COLUMN     "supersededById" TEXT,
ADD COLUMN     "supersedesId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'customer';

-- CreateTable
CREATE TABLE "KnowledgeCandidate" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "originatingConversationId" TEXT,
    "originatingMessageId" TEXT,
    "canonicalQuestion" TEXT NOT NULL,
    "proposedAnswer" TEXT NOT NULL,
    "knowledgeType" "KnowledgeType" NOT NULL,
    "proposedScope" "KnowledgeScope" NOT NULL DEFAULT 'assistant',
    "proposedVisibility" "KnowledgeVisibility" NOT NULL DEFAULT 'public',
    "proposedFreshnessClass" "KnowledgeFreshnessClass" NOT NULL DEFAULT 'STATIC',
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "evidence" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasonForCandidate" TEXT NOT NULL,
    "duplicateOfId" TEXT,
    "similarityScore" DOUBLE PRECISION,
    "status" "CandidateStatus" NOT NULL DEFAULT 'candidate',
    "assignedReviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "finalKnowledgeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeAnswerProvenance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "requestId" TEXT NOT NULL,
    "sourceClass" TEXT NOT NULL,
    "knowledgeContributions" JSONB NOT NULL DEFAULT '[]',
    "webContributions" JSONB NOT NULL DEFAULT '[]',
    "providerUsed" TEXT NOT NULL,
    "providerAttempts" JSONB NOT NULL DEFAULT '[]',
    "webSearchUsed" BOOLEAN NOT NULL DEFAULT false,
    "webSearchRequestedButUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "retrievalSufficiency" TEXT NOT NULL,
    "conflict" JSONB,
    "integrityPassed" BOOLEAN NOT NULL DEFAULT true,
    "freshnessClass" TEXT,
    "privacyClass" TEXT,
    "candidateCreatedId" TEXT,
    "answerCached" BOOLEAN NOT NULL DEFAULT false,
    "servedFromCache" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeAnswerProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRetrievalLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "queryHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "bestSimilarity" DOUBLE PRECISION,
    "sufficiency" TEXT NOT NULL,
    "fromCache" BOOLEAN NOT NULL DEFAULT false,
    "webSearchFollowed" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeRetrievalLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeAnswerCache" (
    "key" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "scopeSig" TEXT NOT NULL,
    "knowledgeVersionFingerprint" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "sourceClass" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeAnswerCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "KnowledgeVersionCounter" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "value" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeVersionCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeCandidate_status_idx" ON "KnowledgeCandidate"("status");

-- CreateIndex
CREATE INDEX "KnowledgeCandidate_createdAt_idx" ON "KnowledgeCandidate"("createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeCandidate_createdByUserId_idx" ON "KnowledgeCandidate"("createdByUserId");

-- CreateIndex
CREATE INDEX "KnowledgeCandidate_originatingConversationId_idx" ON "KnowledgeCandidate"("originatingConversationId");

-- CreateIndex
CREATE INDEX "KnowledgeCandidate_duplicateOfId_idx" ON "KnowledgeCandidate"("duplicateOfId");

-- CreateIndex
CREATE INDEX "KnowledgeCandidate_assignedReviewerId_idx" ON "KnowledgeCandidate"("assignedReviewerId");

-- CreateIndex
CREATE INDEX "KnowledgeAnswerProvenance_userId_idx" ON "KnowledgeAnswerProvenance"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeAnswerProvenance_conversationId_idx" ON "KnowledgeAnswerProvenance"("conversationId");

-- CreateIndex
CREATE INDEX "KnowledgeAnswerProvenance_createdAt_idx" ON "KnowledgeAnswerProvenance"("createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeAnswerProvenance_sourceClass_idx" ON "KnowledgeAnswerProvenance"("sourceClass");

-- CreateIndex
CREATE INDEX "KnowledgeAnswerProvenance_providerUsed_idx" ON "KnowledgeAnswerProvenance"("providerUsed");

-- CreateIndex
CREATE INDEX "KnowledgeRetrievalLog_userId_idx" ON "KnowledgeRetrievalLog"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeRetrievalLog_createdAt_idx" ON "KnowledgeRetrievalLog"("createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeRetrievalLog_sufficiency_idx" ON "KnowledgeRetrievalLog"("sufficiency");

-- CreateIndex
CREATE INDEX "KnowledgeRetrievalLog_conversationId_idx" ON "KnowledgeRetrievalLog"("conversationId");

-- CreateIndex
CREATE INDEX "KnowledgeAnswerCache_expiresAt_idx" ON "KnowledgeAnswerCache"("expiresAt");

-- CreateIndex
CREATE INDEX "Knowledge_scope_lifecycleStatus_idx" ON "Knowledge"("scope", "lifecycleStatus");

-- CreateIndex
CREATE INDEX "Knowledge_supersededById_idx" ON "Knowledge"("supersededById");

-- CreateIndex
CREATE INDEX "Knowledge_expiresAt_idx" ON "Knowledge"("expiresAt");
