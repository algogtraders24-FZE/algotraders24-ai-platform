-- Sprint D2.3 (Phase 7) - Workspace Profiles: one preference row per user.
-- Hand-written (not `prisma migrate dev`, per this repo's established
-- convention - migrate dev's shadow-DB drift check fails on the pgvector
-- migration and would demand a full reset). Purely additive.

CREATE TABLE "WorkspacePreference" (
    "id"               TEXT NOT NULL,
    "userId"           TEXT NOT NULL,
    "profile"          TEXT NOT NULL DEFAULT 'default',
    "symbol"           TEXT,
    "chartInterval"    TEXT NOT NULL DEFAULT 'D',
    "favoriteMarkets"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "collapsedPanels"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sidebarCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "theme"            TEXT NOT NULL DEFAULT 'dark',
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    "deletedAt"        TIMESTAMP(3),

    CONSTRAINT "WorkspacePreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspacePreference_userId_key" ON "WorkspacePreference"("userId");
CREATE INDEX "WorkspacePreference_userId_idx" ON "WorkspacePreference"("userId");
CREATE INDEX "WorkspacePreference_deletedAt_idx" ON "WorkspacePreference"("deletedAt");
