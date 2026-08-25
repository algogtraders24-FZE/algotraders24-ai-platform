-- Sprint D2.7.11 (post-completion, roadmap item 2) - durable, per-user
-- persistence for the Phase 3 multi-symbol tiled chart layout. Hand-
-- written (not `prisma migrate dev`), per this repo's established
-- convention. Purely additive: one new table, zero changes to any
-- existing table, column, or constraint.

CREATE TABLE "ChartWorkspaceLayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'native',
    "layout" INTEGER NOT NULL DEFAULT 1,
    "panes" JSONB NOT NULL DEFAULT '[]',
    "primaryPaneIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartWorkspaceLayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChartWorkspaceLayout_userId_key" ON "ChartWorkspaceLayout"("userId");
