-- AI Arena (forex, gold, energy, indices): decision-time snapshots, AI decisions and run log. Additive only.
CREATE TABLE IF NOT EXISTS "arena_fx_snapshots" (
    "id" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price" DOUBLE PRECISION NOT NULL,
    "atrPct" DOUBLE PRECISION NOT NULL,
    "alignment" TEXT NOT NULL,
    "features" JSONB NOT NULL,

    CONSTRAINT "arena_fx_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "arena_fx_snapshots_dayKey_symbol_key" ON "arena_fx_snapshots"("dayKey", "symbol");
CREATE INDEX IF NOT EXISTS "arena_fx_snapshots_dayKey_idx" ON "arena_fx_snapshots"("dayKey");

CREATE TABLE IF NOT EXISTS "arena_fx_decisions" (
    "id" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "contestant" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arena_fx_decisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "arena_fx_decisions_dayKey_symbol_contestant_key" ON "arena_fx_decisions"("dayKey", "symbol", "contestant");
CREATE INDEX IF NOT EXISTS "arena_fx_decisions_contestant_idx" ON "arena_fx_decisions"("contestant");

CREATE TABLE IF NOT EXISTS "arena_fx_runs" (
    "id" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "contestant" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arena_fx_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "arena_fx_runs_dayKey_contestant_key" ON "arena_fx_runs"("dayKey", "contestant");
