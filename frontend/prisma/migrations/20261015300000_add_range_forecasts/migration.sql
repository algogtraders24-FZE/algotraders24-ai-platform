-- Calibration scoreboard: one row per instrument per 4-hour slot, settled after 12h / 24h. Additive only.
-- The runner and the public page tolerate the table being absent, so applying this after the code deploy is safe.
CREATE TABLE IF NOT EXISTS "range_forecasts" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "atr" DOUBLE PRECISION NOT NULL,
    "band12" DOUBLE PRECISION NOT NULL,
    "band24" DOUBLE PRECISION NOT NULL,
    "priceLater12" DOUBLE PRECISION,
    "priceLater24" DOUBLE PRECISION,
    "inside12" BOOLEAN,
    "inside24" BOOLEAN,
    "settled12" BOOLEAN NOT NULL DEFAULT false,
    "settled24" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "range_forecasts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "range_forecasts_symbol_issuedAt_key" ON "range_forecasts"("symbol", "issuedAt");
CREATE INDEX IF NOT EXISTS "range_forecasts_issuedAt_idx" ON "range_forecasts"("issuedAt");
