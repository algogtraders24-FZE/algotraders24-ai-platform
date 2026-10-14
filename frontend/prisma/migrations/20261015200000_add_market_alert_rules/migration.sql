-- Market alerts (price near yesterday's high/low, volatility turns high, high-impact event soon): one rule per user, symbol and kind.
-- Additive only. The runner and the page tolerate the table being absent, so applying this after the code deploy is safe.
CREATE TABLE IF NOT EXISTS "market_alert_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cooldownMin" INTEGER NOT NULL DEFAULT 120,
    "state" TEXT NOT NULL DEFAULT 'ok',
    "lastFiredAt" TIMESTAMP(3),
    "lastValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_alert_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "market_alert_rules_userId_symbol_kind_key" ON "market_alert_rules"("userId", "symbol", "kind");
CREATE INDEX IF NOT EXISTS "market_alert_rules_enabled_symbol_idx" ON "market_alert_rules"("enabled", "symbol");
