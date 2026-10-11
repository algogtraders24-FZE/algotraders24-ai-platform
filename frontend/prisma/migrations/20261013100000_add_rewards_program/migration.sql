-- AT24 Rewards & Partner Program, Phase 1 foundation. Additive only: 14 new tables, nothing existing is touched. NOT applied to any database yet.

-- CreateTable
CREATE TABLE IF NOT EXISTS "reward_products" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listingId" TEXT,
    "listPriceCents" INTEGER NOT NULL,
    "rebateCents" INTEGER NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 4,
    "intervalDays" INTEGER NOT NULL DEFAULT 90,
    "termMonths" INTEGER NOT NULL DEFAULT 12,
    "referralCents" INTEGER[],
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reward_slot_months" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "limit" INTEGER NOT NULL,
    "opened" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_slot_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reward_slot_holds" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "invoiceRef" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_slot_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reward_contracts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "licenseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_DOCUMENT',
    "listPriceCents" INTEGER NOT NULL,
    "rebateTotalCents" INTEGER NOT NULL,
    "netPriceCents" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reward_contract_documents" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_contract_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rebate_installments" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "releasedAt" TIMESTAMP(3),
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rebate_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "referral_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "referral_attributions" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "referral_commissions" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reward_ledger_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reward_reserve_entries" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_reserve_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reward_payouts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT NOT NULL DEFAULT 'USDT',
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "txRef" TEXT,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reward_download_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_download_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reward_audit_events" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reward_products_key_key" ON "reward_products"("key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reward_slot_months_month_productKey_key" ON "reward_slot_months"("month", "productKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_slot_holds_month_productKey_status_idx" ON "reward_slot_holds"("month", "productKey", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_slot_holds_userId_idx" ON "reward_slot_holds"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reward_contracts_purchaseId_key" ON "reward_contracts"("purchaseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_contracts_userId_status_idx" ON "reward_contracts"("userId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_contracts_productKey_status_idx" ON "reward_contracts"("productKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reward_contract_documents_contractId_key" ON "reward_contract_documents"("contractId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rebate_installments_userId_status_idx" ON "rebate_installments"("userId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rebate_installments_status_dueAt_idx" ON "rebate_installments"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "rebate_installments_contractId_seq_key" ON "rebate_installments"("contractId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "referral_codes_userId_key" ON "referral_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "referral_attributions_purchaseId_key" ON "referral_attributions"("purchaseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "referral_attributions_buyerId_idx" ON "referral_attributions"("buyerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "referral_attributions_partnerId_idx" ON "referral_attributions"("partnerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "referral_commissions_partnerId_status_idx" ON "referral_commissions"("partnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "referral_commissions_purchaseId_level_key" ON "referral_commissions"("purchaseId", "level");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reward_ledger_entries_idempotencyKey_key" ON "reward_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_ledger_entries_userId_createdAt_idx" ON "reward_ledger_entries"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reward_reserve_entries_idempotencyKey_key" ON "reward_reserve_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_reserve_entries_contractId_idx" ON "reward_reserve_entries"("contractId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_payouts_userId_createdAt_idx" ON "reward_payouts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_payouts_status_idx" ON "reward_payouts"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_download_logs_contractId_createdAt_idx" ON "reward_download_logs"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_audit_events_subjectType_subjectId_idx" ON "reward_audit_events"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_audit_events_createdAt_idx" ON "reward_audit_events"("createdAt");

