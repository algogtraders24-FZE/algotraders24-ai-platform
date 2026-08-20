-- Sprint D2.7.11 Phase 4 - saved chart templates (a named, reusable bundle
-- of active indicators + drawn objects, MT5's own real Template feature).
-- Hand-written (not `prisma migrate dev`, per this repo's established
-- convention - migrate dev's shadow-DB drift check fails on the pgvector
-- migration and would demand a full reset). Purely additive.

CREATE TABLE "ChartTemplate" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "indicatorKeys"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "drawingObjects" JSONB NOT NULL DEFAULT '[]',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChartTemplate_userId_name_key" ON "ChartTemplate"("userId", "name");
CREATE INDEX "ChartTemplate_userId_idx" ON "ChartTemplate"("userId");
