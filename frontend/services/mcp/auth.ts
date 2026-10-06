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
  /** When the token last authenticated (null = never). Used to throttle bookkeeping writes. */
  lastUsedAt: Date | null;
  /** Account status of the owning user ("active" required). */
  userStatus: string;
}

export interface McpTokenStore {
  findByHash(tokenHash: string): Promise<McpTokenRecord | null>;
  touchLastUsed(tokenId: string, at: Date): Promise<void>;
}

const VALID_SCOPES: readonly McpScope[] = ["read"];

/** "Last used" is refreshed at most this often per token (keeps DB writes low). */
export const TOUCH_INTERVAL_MS = 60_000;
/** The request never waits longer than this for the bookkeeping write. */
export const TOUCH_TIMEOUT_MS = 1_500;

/**
 * Runs the bookkeeping write and WAITS for it (bounded). A fire-and-forget write
 * is not safe on serverless: the function is frozen as soon as the response is
 * sent, so an un-awaited write often never completes (that is why "last used"
 * stayed empty). Errors and slowness are swallowed - bookkeeping can never fail
 * or stall an authenticated request.
 */
async function touchBounded(store: McpTokenStore, tokenId: string, at: Date): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      store.touchLastUsed(tokenId, at).catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, TOUCH_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // a store that throws synchronously must not break authentication either
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

  if (!record.lastUsedAt || now.getTime() - record.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS) {
    await touchBounded(store, record.id, now);
  }
  return { userId: record.userId, tokenId: record.id, scopes };
}
