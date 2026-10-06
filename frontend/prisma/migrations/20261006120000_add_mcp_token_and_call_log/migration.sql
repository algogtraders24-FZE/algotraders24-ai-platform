-- AT24 MCP server v1 (additive only: two new tables, no changes to existing ones).
-- NOT APPLIED to production without explicit owner go-ahead.

-- CreateTable
CREATE TABLE "mcp_api_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['read']::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_call_logs" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "creditsConsumed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_api_tokens_tokenHash_key" ON "mcp_api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "mcp_api_tokens_userId_createdAt_idx" ON "mcp_api_tokens"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "mcp_call_logs_userId_tool_createdAt_idx" ON "mcp_call_logs"("userId", "tool", "createdAt");

-- CreateIndex
CREATE INDEX "mcp_call_logs_tokenId_createdAt_idx" ON "mcp_call_logs"("tokenId", "createdAt");
