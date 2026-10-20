-- Product announcements (admin-written "what is new" emails) + per-user opt-out. Additive only.
CREATE TABLE IF NOT EXISTS "product_announcements" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "bodyText" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "product_announcements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_announcements_status_createdAt_idx" ON "product_announcements"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "announcement_deliveries" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcement_deliveries_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "product_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "announcement_deliveries_announcementId_userId_key" ON "announcement_deliveries"("announcementId", "userId");

CREATE TABLE IF NOT EXISTS "email_opt_outs" (
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_opt_outs_pkey" PRIMARY KEY ("userId")
);
