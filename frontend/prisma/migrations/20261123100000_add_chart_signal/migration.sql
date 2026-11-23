-- CreateTable (additive only)
CREATE TABLE IF NOT EXISTS "ChartSignal" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "symbol"          TEXT NOT NULL,
    "timeframe"       TEXT NOT NULL,
    "dir"             TEXT NOT NULL,
    "entryType"       TEXT NOT NULL,
    "entry"           DOUBLE PRECISION NOT NULL,
    "stop"            DOUBLE PRECISION NOT NULL,
    "target"          DOUBLE PRECISION NOT NULL,
    "rr"              DOUBLE PRECISION NOT NULL,
    "score"           INTEGER NOT NULL,
    "scoreMax"        INTEGER NOT NULL,
    "confluences"     JSONB NOT NULL DEFAULT '[]',
    "source"          TEXT,
    "signalTime"      TIMESTAMP(3) NOT NULL,
    "lastClose"       DOUBLE PRECISION NOT NULL,
    "dedupeKey"       TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'open',
    "filledAt"        TIMESTAMP(3),
    "closedAt"        TIMESTAMP(3),
    "resultR"         DOUBLE PRECISION,
    "resolvedThrough" TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChartSignal_userId_dedupeKey_key" ON "ChartSignal"("userId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "ChartSignal_userId_createdAt_idx" ON "ChartSignal"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChartSignal_status_idx" ON "ChartSignal"("status");
CREATE INDEX IF NOT EXISTS "ChartSignal_symbol_timeframe_idx" ON "ChartSignal"("symbol", "timeframe");
