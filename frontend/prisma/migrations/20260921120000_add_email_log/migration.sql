-- CreateTable
CREATE TABLE "EmailLog" (
    "id"                TEXT NOT NULL,
    "type"              TEXT NOT NULL,
    "recipientEmail"    TEXT NOT NULL,
    "recipientUserId"   TEXT,
    "dedupeKey"         TEXT,
    "providerMessageId" TEXT,
    "status"            TEXT NOT NULL,
    "errorMessage"      TEXT,
    "sentAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_type_dedupeKey_key" ON "EmailLog"("type", "dedupeKey");

-- CreateIndex
CREATE INDEX "EmailLog_recipientUserId_idx" ON "EmailLog"("recipientUserId");

-- CreateIndex
CREATE INDEX "EmailLog_type_sentAt_idx" ON "EmailLog"("type", "sentAt");
