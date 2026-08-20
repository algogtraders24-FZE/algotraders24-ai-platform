-- Sprint D2.7.11 Phase 1b - durable persistence for chart drawn objects
-- (trend lines, horizontal lines, rectangles, Fibonacci retracements).
-- Hand-written (not `prisma migrate dev`, per this repo's established
-- convention - migrate dev's shadow-DB drift check fails on the pgvector
-- migration and would demand a full reset). Purely additive: one new
-- table, zero changes to any existing table, column, or constraint.

CREATE TABLE "ChartDrawingSet" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "symbol"    TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "objects"   JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartDrawingSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChartDrawingSet_userId_symbol_timeframe_key" ON "ChartDrawingSet"("userId", "symbol", "timeframe");
CREATE INDEX "ChartDrawingSet_userId_idx" ON "ChartDrawingSet"("userId");
