-- Sprint M11 - License & Product Protection Architecture. Hand-written
-- (not `prisma migrate dev`, per this repo's established convention - see
-- the pgvector shadow-DB drift-check note on
-- 20260813090000_add_outcome_idempotency_guard). Purely additive: five
-- new tables, zero changes to any existing table, column, or constraint.
--
-- IMPORTANT: this migration file has been generated but is NOT applied to
-- the live database as of the end of Sprint M11, per explicit instruction
-- (Section 21/25 of the M11 brief: "Production migration requires
-- explicit approval. Do not silently apply irreversible production
-- changes."). Do not run `prisma migrate deploy` (or otherwise apply this
-- file) without a separate, explicit go-ahead - see
-- ea-research/marketplace-research/m11-license-architecture/ for the full
-- reasoning.

CREATE TABLE "release_artifacts" (
    "id" TEXT NOT NULL,
    "tradingSystemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "marketplaceListingId" TEXT,
    "platform" TEXT NOT NULL,
    "artifactVersion" TEXT NOT NULL,
    "artifactHash" TEXT NOT NULL,
    "releaseStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "release_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "release_artifacts_tradingSystemId_versionId_platform_artif_key"
  ON "release_artifacts"("tradingSystemId", "versionId", "platform", "artifactHash");
CREATE INDEX "release_artifacts_marketplaceListingId_idx" ON "release_artifacts"("marketplaceListingId");
CREATE INDEX "release_artifacts_platform_idx" ON "release_artifacts"("platform");
CREATE INDEX "release_artifacts_releaseStatus_idx" ON "release_artifacts"("releaseStatus");
CREATE INDEX "release_artifacts_deletedAt_idx" ON "release_artifacts"("deletedAt");

CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "marketplaceListingId" TEXT NOT NULL,
    "tradingSystemId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "provider" TEXT,
    "providerRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchases_providerRef_key" ON "purchases"("providerRef");
CREATE INDEX "purchases_buyerId_idx" ON "purchases"("buyerId");
CREATE INDEX "purchases_marketplaceListingId_idx" ON "purchases"("marketplaceListingId");
CREATE INDEX "purchases_status_idx" ON "purchases"("status");
CREATE INDEX "purchases_deletedAt_idx" ON "purchases"("deletedAt");

CREATE TABLE "entitlements" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "tradingSystemId" TEXT NOT NULL,
    "marketplaceListingId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "entitlements_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "entitlements_buyerId_idx" ON "entitlements"("buyerId");
CREATE INDEX "entitlements_purchaseId_idx" ON "entitlements"("purchaseId");
CREATE INDEX "entitlements_status_idx" ON "entitlements"("status");
CREATE INDEX "entitlements_deletedAt_idx" ON "entitlements"("deletedAt");

CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "tradingSystemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "licenseStatus" TEXT NOT NULL DEFAULT 'ISSUED',
    "licenseSchemaVersion" TEXT NOT NULL DEFAULT 'M11-license-v1',
    "activationPolicy" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "signature" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "licenses_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "licenses_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "licenses_entitlementId_idx" ON "licenses"("entitlementId");
CREATE INDEX "licenses_buyerId_idx" ON "licenses"("buyerId");
CREATE INDEX "licenses_releaseId_idx" ON "licenses"("releaseId");
CREATE INDEX "licenses_licenseStatus_idx" ON "licenses"("licenseStatus");

CREATE TABLE "activations" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "deviceBindingId" TEXT NOT NULL,
    "deviceLabel" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "activations_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "activations_licenseId_deviceBindingId_key" ON "activations"("licenseId", "deviceBindingId");
CREATE INDEX "activations_licenseId_idx" ON "activations"("licenseId");
CREATE INDEX "activations_status_idx" ON "activations"("status");
