// services/mcp/prisma-stores.ts
// AT24 MCP v1 - Prisma-backed implementations of the injected stores.
// Kept out of the pure modules so tests never need a database.

import { prisma } from "@/lib/prisma";
import type { McpTokenRecord, McpTokenStore } from "./auth";
import type { McpAuditRecord } from "./facade";
import type { McpUsageStore } from "./quota";

export const prismaMcpTokenStore: McpTokenStore = {
  async findByHash(tokenHash: string): Promise<McpTokenRecord | null> {
    const row = await prisma.mcpApiToken.findUnique({ where: { tokenHash } });
    if (!row) return null;
    const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { status: true } });
    return {
      id: row.id,
      userId: row.userId,
      scopes: row.scopes,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      userStatus: user?.status ?? "missing",
    };
  },
  async touchLastUsed(tokenId: string, at: Date): Promise<void> {
    await prisma.mcpApiToken.update({ where: { id: tokenId }, data: { lastUsedAt: at } });
  },
};

export const prismaMcpUsageStore: McpUsageStore = {
  async countSince(userId: string, tool: string, since: Date): Promise<number> {
    return prisma.mcpCallLog.count({ where: { userId, tool, createdAt: { gte: since } } });
  },
};

/** Metadata-only audit row. Doubles as the quota meter. */
export async function prismaMcpAudit(record: McpAuditRecord): Promise<void> {
  await prisma.mcpCallLog.create({
    data: {
      tokenId: record.tokenId,
      userId: record.userId,
      tool: record.tool,
      ok: record.ok,
      errorCode: record.errorCode ?? null,
      creditsConsumed: record.creditsConsumed,
      durationMs: Math.max(0, Math.round(record.durationMs)),
    },
  });
}
