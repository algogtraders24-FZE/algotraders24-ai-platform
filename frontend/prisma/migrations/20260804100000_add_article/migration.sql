-- Sprint D2.3.S1 - Publishing Activation: real, DB-backed articles.
-- Hand-written (not `prisma migrate dev`, per this repo's established
-- convention - migrate dev's shadow-DB drift check fails on the pgvector
-- migration and would demand a full reset). Purely additive.

CREATE TYPE "ArticleStatus" AS ENUM ('draft', 'scheduled', 'published', 'failed');

CREATE TABLE "articles" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "category"     TEXT NOT NULL,
    "summary"      TEXT NOT NULL DEFAULT '',
    "sections"     JSONB NOT NULL DEFAULT '[]',
    "disclaimer"   TEXT NOT NULL DEFAULT 'This is not financial advice. Trading involves risk.',
    "seo"          JSONB NOT NULL DEFAULT '{}',
    "slug"         TEXT NOT NULL,
    "status"       "ArticleStatus" NOT NULL DEFAULT 'draft',
    "scheduledFor" TIMESTAMP(3),
    "publishedAt"  TIMESTAMP(3),
    "history"      JSONB NOT NULL DEFAULT '[]',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    "deletedAt"    TIMESTAMP(3),

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "articles_userId_slug_key" ON "articles"("userId", "slug");
CREATE INDEX "articles_userId_idx" ON "articles"("userId");
CREATE INDEX "articles_userId_status_idx" ON "articles"("userId", "status");
CREATE INDEX "articles_deletedAt_idx" ON "articles"("deletedAt");
