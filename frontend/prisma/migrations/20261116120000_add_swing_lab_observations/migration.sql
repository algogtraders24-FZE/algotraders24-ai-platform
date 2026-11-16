-- Swing Lab forward scoreboard: daily trend-alignment snapshots scored 5 days later. Additive only.
CREATE TABLE IF NOT EXISTS "swing_lab_observations" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barTime" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "atrPct" DOUBLE PRECISION NOT NULL,
    "alignment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "fwdPrice" DOUBLE PRECISION,
    "rawAtr" DOUBLE PRECISION,
    "r" DOUBLE PRECISION,
    "evaluatedAt" TIMESTAMP(3),

    CONSTRAINT "swing_lab_observations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "swing_lab_observations_symbol_dayKey_key" ON "swing_lab_observations"("symbol", "dayKey");
CREATE INDEX IF NOT EXISTS "swing_lab_observations_status_createdAt_idx" ON "swing_lab_observations"("status", "createdAt");
