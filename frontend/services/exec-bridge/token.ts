// services/exec-bridge/token.ts
// Device tokens for the Execute EA. Same primitives as Live Sync's, but a DIFFERENT prefix and table: a read-only sync token can never receive orders,
// and an execute token can never write sync data.
import { randomBytes } from "node:crypto";
import { sha256Hex } from "@/services/live-sync/crypto";
import { EXEC } from "./config";

const TOKEN_BYTES = 32;
const DISPLAY_PREFIX_LEN = 13;
const MAX_BEARER_LEN = 200;

export function generateExecToken(): { raw: string; tokenHash: string; prefix: string } {
  const raw = EXEC.tokenPrefix + randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, tokenHash: sha256Hex(raw), prefix: raw.slice(0, DISPLAY_PREFIX_LEN) };
}

export const hashExecToken = (raw: string): string => sha256Hex(raw);

/** Extracts a well-formed execute token from an Authorization header, else null. */
export function parseExecBearer(header: string | null | undefined): string | null {
  if (!header || header.length > MAX_BEARER_LEN + 7) return null;
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header.trim());
  if (!m) return null;
  const token = m[1]!;
  return token.startsWith(EXEC.tokenPrefix) && token.length <= MAX_BEARER_LEN ? token : null;
}
