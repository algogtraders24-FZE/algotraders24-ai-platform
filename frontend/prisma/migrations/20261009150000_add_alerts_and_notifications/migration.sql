-- AT24 Live Sync alerts + generic user notifications (additive only: two new tables, nothing existing is changed).
-- NOT APPLIED to production without explicit owner go-ahead.

-- CreateTable
CREATE TABLE "live_sync_alert_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyBell" BOOLEAN NOT NULL DEFAULT true,
    "cooldownMin" INTEGER NOT NULL DEFAULT 60,
    "state" TEXT NOT NULL DEFAULT 'ok',
    "lastFiredAt" TIMESTAMP(3),
    "lastValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_sync_alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "href" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_sync_alert_rules_accountId_kind_key" ON "live_sync_alert_rules"("accountId", "kind");

-- CreateIndex
CREATE INDEX "live_sync_alert_rules_userId_idx" ON "live_sync_alert_rules"("userId");

-- CreateIndex
CREATE INDEX "user_notifications_userId_createdAt_idx" ON "user_notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "user_notifications_userId_readAt_idx" ON "user_notifications"("userId", "readAt");
