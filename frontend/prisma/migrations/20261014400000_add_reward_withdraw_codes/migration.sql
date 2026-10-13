-- Wallet: one-time emailed 6-digit code that confirms a withdrawal (additive). Only a salted hash of the code is stored.
CREATE TABLE IF NOT EXISTS "reward_withdraw_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_withdraw_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reward_withdraw_codes_userId_createdAt_idx" ON "reward_withdraw_codes"("userId", "createdAt");
