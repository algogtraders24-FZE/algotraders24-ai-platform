-- AlterTable
ALTER TABLE "Knowledge" ADD COLUMN     "author" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN     "collectionId" TEXT,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "documentSize" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "embeddingStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "fileType" TEXT NOT NULL DEFAULT 'md',
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "lastIndexed" TIMESTAMP(3),
ADD COLUMN     "popularity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'gemini',
ADD COLUMN     "retrievalCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "KnowledgeCollection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeCollection_userId_idx" ON "KnowledgeCollection"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeCollection_deletedAt_idx" ON "KnowledgeCollection"("deletedAt");

-- CreateIndex
CREATE INDEX "Knowledge_category_idx" ON "Knowledge"("category");

-- CreateIndex
CREATE INDEX "Knowledge_collectionId_idx" ON "Knowledge"("collectionId");
