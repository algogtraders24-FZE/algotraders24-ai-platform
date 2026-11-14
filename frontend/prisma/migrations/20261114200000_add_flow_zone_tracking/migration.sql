-- Crypto Flow Zones: forward scoreboard observations + member Telegram alert subscriptions. Additive only.
CREATE TABLE IF NOT EXISTS "flow_zone_observations" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "hourKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barTime" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "stepPct" DOUBLE PRECISION NOT NULL,
    "xRangePct" DOUBLE PRECISION NOT NULL,
    "buyerPrice" DOUBLE PRECISION,
    "sellerPrice" DOUBLE PRECISION,
    "pocPrice" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'open',
    "buyerTouchAt" TIMESTAMP(3),
    "buyerR" DOUBLE PRECISION,
    "sellerTouchAt" TIMESTAMP(3),
    "sellerR" DOUBLE PRECISION,
    "evaluatedAt" TIMESTAMP(3),

    CONSTRAINT "flow_zone_observations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "flow_zone_observations_symbol_hourKey_key" ON "flow_zone_observations"("symbol", "hourKey");
CREATE INDEX IF NOT EXISTS "flow_zone_observations_status_createdAt_idx" ON "flow_zone_observations"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "flow_zone_alert_subs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBuyerObsId" TEXT,
    "lastBuyerAt" TIMESTAMP(3),
    "lastSellerObsId" TEXT,
    "lastSellerAt" TIMESTAMP(3),

    CONSTRAINT "flow_zone_alert_subs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "flow_zone_alert_subs_userId_symbol_key" ON "flow_zone_alert_subs"("userId", "symbol");
CREATE INDEX IF NOT EXISTS "flow_zone_alert_subs_symbol_idx" ON "flow_zone_alert_subs"("symbol");
