// services/mcp/auth.ts
// AT24 MCP v1 - bearer-token authentication. Storage is injected so the logic
// is testable without a DB. Fails closed on every doubt (unknown, revoked,
// expired, wrong scope, inactive user, store error) and never distinguishes
// the reason to the caller.

import type { McpPrincipal, McpScope } from "./facade";
import { hashMcpToken, parseBearerToken } from "./token";

export interface McpTokenRecord {
  id: string;
  userId: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  /** Account status of the owning user ("active" required). */
  userStatus: string;
}

export interface McpTokenStore {
  findByHash(tokenHash: string): Promise<McpTokenRecord | null>;
  touchLastUsed(tokenId: string, at: Date): Promise<void>;
}

const VALID_SCOPES: readonly McpScope[] = ["read"];

export async function authenticateBearer(
  store: McpTokenStore,
  authorizationHeader: string | null | undefined,
  now: Date = new Date(),
): Promise<McpPrincipal | null> {
  const raw = parseBearerToken(authorizationHeader);
  if (!raw) return null;
  let record: McpTokenRecord | null;
  try {
    record = await store.findByHash(hashMcpToken(raw));
  } catch {
    return null; // fail closed
  }
  if (!record) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) return null;
  if (record.userStatus !== "active") return null;
  const scopes = record.scopes.filter((s): s is McpScope => (VALID_SCOPES as readonly string[]).includes(s));
  if (!scopes.includes("read")) return null;

  // Best-effort bookkeeping; never blocks or fails the request.
  void store.touchLastUsed(record.id, now).catch(() => undefined);
  return { userId: record.userId, tokenId: record.id, scopes };
}
