-- Sprint R1.2 - Beta feedback + internal analytics event log.
-- Hand-written (not `prisma migrate dev`, per this repo's established
-- convention - migrate dev's shadow-DB drift check fails on the pgvector
-- migration and would demand a full reset). Purely additive.

CREATE TABLE "Feedback" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "type"      TEXT NOT NULL,
    "message"   TEXT NOT NULL,
    "page"      TEXT NOT NULL DEFAULT '',
    "status"    TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Feedback_userId_idx" ON "Feedback"("userId");
CREATE INDEX "Feedback_status_idx" ON "Feedback"("status");
CREATE INDEX "Feedback_type_idx" ON "Feedback"("type");
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

CREATE TABLE "AnalyticsEvent" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT,
    "type"      TEXT NOT NULL,
    "metadata"  JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsEvent_userId_idx" ON "AnalyticsEvent"("userId");
CREATE INDEX "AnalyticsEvent_type_idx" ON "AnalyticsEvent"("type");
CREATE INDEX "AnalyticsEvent_userId_type_idx" ON "AnalyticsEvent"("userId", "type");
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");
