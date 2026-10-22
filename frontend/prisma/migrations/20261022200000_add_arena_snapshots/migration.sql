-- AT24 Arena: latest paper-desk snapshot pushed by the VPS bot. Additive only.
CREATE TABLE IF NOT EXISTS "arena_snapshots" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "lastBar" TEXT,
    "live" JSONB,
    "liveAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arena_snapshots_pkey" PRIMARY KEY ("id")
);
