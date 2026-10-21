-- Bonus AI credits earned by verification steps (additive: one new table, nothing else is touched).
CREATE TABLE IF NOT EXISTS "bonus_credit_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonus_credit_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bonus_credit_grants_userId_kind_key" ON "bonus_credit_grants"("userId", "kind");
CREATE INDEX IF NOT EXISTS "bonus_credit_grants_userId_expiresAt_idx" ON "bonus_credit_grants"("userId", "expiresAt");
