-- 30-day free demo + demo contest (additive: three new tables).
CREATE TABLE "trial_email_logs" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trial_email_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trial_email_logs_licenseId_step_key" ON "trial_email_logs"("licenseId", "step");

CREATE TABLE "contests" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tradingSystemId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "magic" TEXT NOT NULL DEFAULT '33302',
    "rules" JSONB NOT NULL DEFAULT '{}',
    "prizeMonths" INTEGER NOT NULL DEFAULT 3,
    "offerPercent" INTEGER NOT NULL DEFAULT 20,
    "offerValidDays" INTEGER NOT NULL DEFAULT 14,
    "winners" JSONB,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contests_slug_key" ON "contests"("slug");

CREATE TABLE "contest_entries" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "offerToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contest_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contest_entries_contestId_userId_key" ON "contest_entries"("contestId", "userId");
CREATE UNIQUE INDEX "contest_entries_contestId_accountId_key" ON "contest_entries"("contestId", "accountId");
CREATE INDEX "contest_entries_contestId_idx" ON "contest_entries"("contestId");
ALTER TABLE "contest_entries" ADD CONSTRAINT "contest_entries_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
