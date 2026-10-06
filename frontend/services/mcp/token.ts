// services/mcp/token.ts
// AT24 MCP v1 - API token primitives. Pure (node:crypto only).
// The raw token is shown to the user exactly once; only its sha256 is stored.

import { createHash, randomBytes } from "node:crypto";

export const MCP_TOKEN_PREFIX = "at24_mcp_";
/** 32 random bytes => 256 bits of entropy, so a fast hash (sha256) is sufficient at rest. */
const TOKEN_BYTES = 32;
export const MCP_TOKEN_DISPLAY_PREFIX_LEN = 12;
const MAX_BEARER_LEN = 200;

export interface GeneratedMcpToken {
  /** Shown to the user once. Never persisted. */
  raw: string;
  tokenHash: string;
  /** Safe-to-display leading characters. */
  prefix: string;
}

export function hashMcpToken(raw: string): string {
  return createHash("sha256").update(raw, "utf-8").digest("hex");
}

export function generateMcpToken(): GeneratedMcpToken {
  const raw = MCP_TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, tokenHash: hashMcpToken(raw), prefix: raw.slice(0, MCP_TOKEN_DISPLAY_PREFIX_LEN) };
}

/** Extracts a well-formed AT24 MCP token from an Authorization header, else null. */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header || header.length > MAX_BEARER_LEN + 7) return null;
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header.trim());
  if (!m) return null;
  const token = m[1]!;
  if (!token.startsWith(MCP_TOKEN_PREFIX) || token.length > MAX_BEARER_LEN) return null;
  return token;
}
