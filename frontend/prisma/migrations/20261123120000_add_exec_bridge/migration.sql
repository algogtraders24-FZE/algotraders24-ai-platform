-- CreateTable (additive only)
CREATE TABLE IF NOT EXISTS "exec_devices" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "prefix"     TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"  TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "exec_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "exec_orders" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "clientNonce"  TEXT NOT NULL,
    "symbol"       TEXT NOT NULL,
    "side"         TEXT NOT NULL,
    "kind"         TEXT NOT NULL,
    "volume"       DOUBLE PRECISION NOT NULL,
    "price"        DOUBLE PRECISION,
    "stopLoss"     DOUBLE PRECISION NOT NULL,
    "takeProfit"   DOUBLE PRECISION,
    "status"       TEXT NOT NULL DEFAULT 'queued',
    "expiresAt"    TIMESTAMP(3) NOT NULL,
    "confirmedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt"    TIMESTAMP(3),
    "claimedBy"    TEXT,
    "reportedAt"   TIMESTAMP(3),
    "ticket"       TEXT,
    "fillPrice"    DOUBLE PRECISION,
    "retcode"      INTEGER,
    "reason"       TEXT,
    "planSnapshot" JSONB,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exec_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exec_devices_tokenHash_key" ON "exec_devices"("tokenHash");
CREATE INDEX IF NOT EXISTS "exec_devices_userId_createdAt_idx" ON "exec_devices"("userId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "exec_orders_userId_clientNonce_key" ON "exec_orders"("userId", "clientNonce");
CREATE INDEX IF NOT EXISTS "exec_orders_userId_status_idx" ON "exec_orders"("userId", "status");
CREATE INDEX IF NOT EXISTS "exec_orders_status_expiresAt_idx" ON "exec_orders"("status", "expiresAt");
