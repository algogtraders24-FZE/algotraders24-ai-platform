-- Sprint L2.7 - Payment provider linkage + durable request tracking.
-- Hand-written (not `prisma migrate dev`, per this repo's established
-- convention - migrate dev's shadow-DB drift check fails on the pgvector
-- migration and would demand a full reset). Purely additive.

ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

ALTER TABLE "Subscription" ADD COLUMN "provider" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "nowPaymentsInvoiceId" TEXT;
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");
CREATE UNIQUE INDEX "Subscription_nowPaymentsInvoiceId_key" ON "Subscription"("nowPaymentsInvoiceId");

CREATE TABLE "RequestLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RequestLog_userId_idx" ON "RequestLog"("userId");
CREATE INDEX "RequestLog_type_idx" ON "RequestLog"("type");
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");
