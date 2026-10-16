-- Social outbox: posts prepared for AT24's own social accounts. Additive only; the runner and the admin page tolerate the table being absent.
CREATE TABLE IF NOT EXISTS "social_posts" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "shortText" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "linkUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB,
    "error" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "social_posts_dedupeKey_key" ON "social_posts"("dedupeKey");
CREATE INDEX IF NOT EXISTS "social_posts_status_createdAt_idx" ON "social_posts"("status", "createdAt");
