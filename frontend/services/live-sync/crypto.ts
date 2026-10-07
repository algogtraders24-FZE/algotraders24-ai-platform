// services/live-sync/crypto.ts
// AT24 Live Sync (P1) - token primitives, the per-user account salt and the batch
// hash chain. Pure (node:crypto only).
//
// Chain design: the EA (MQL5) and this server must produce the SAME hash, and MQL5
// and TypeScript format decimals differently, so the hash covers INTEGERS only:
// ticket, server-time ms, and money rounded to cents. The values themselves are
// stored exactly as received; the chain commits to WHICH deals were reported, in
// WHAT order, with WHAT result, so a reported trade cannot later be removed,
// reordered or altered without breaking the chain.

import { createHash, randomBytes } from "node:crypto";
import type { WireDeal } from "./contract";

export const SYNC_TOKEN_PREFIX = "at24_sync_";
const TOKEN_BYTES = 32;
const DISPLAY_PREFIX_LEN = 13;
const MAX_BEARER_LEN = 200;

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf-8").digest("hex");

export function generateSyncToken(): { raw: string; tokenHash: string; prefix: string } {
  const raw = SYNC_TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, tokenHash: sha256Hex(raw), prefix: raw.slice(0, DISPLAY_PREFIX_LEN) };
}

export function hashSyncToken(raw: string): string {
  return sha256Hex(raw);
}

/** Extracts a well-formed device token from an Authorization header, else null. */
export function parseSyncBearer(header: string | null | undefined): string | null {
  if (!header || header.length > MAX_BEARER_LEN + 7) return null;
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header.trim());
  if (!m) return null;
  const token = m[1]!;
  return token.startsWith(SYNC_TOKEN_PREFIX) && token.length <= MAX_BEARER_LEN ? token : null;
}

/**
 * Per-user salt for accountKey = SHA-256(login|server|salt). It only needs to be
 * unique per user (it stops one precomputed table from working across users); it
 * is NOT a secret, so it is derived deterministically and needs no new env var.
 */
export function accountSaltFor(userId: string): string {
  return sha256Hex(`at24-live-sync-v1|${userId}`);
}

/** Money to integer cents exactly as the EA does: round half away from zero. */
export function cents(x: number): number {
  const r = Math.round(Math.abs(x) * 100);
  const v = x < 0 ? -r : r;
  return v === 0 ? 0 : v; // never "-0"
}

export function dealCanonical(d: WireDeal): string {
  return `${d.ticket}:${d.timeMsc}:${cents(d.profit)}:${cents(d.commission)}:${cents(d.swap)}:${cents(d.fee)}`;
}

/** hash = SHA-256(prevHash "|" seq "|" deal1 ";" deal2 ...) over the canonical integer form. */
export function computeBatchHash(prevHash: string, seq: number, deals: readonly WireDeal[]): string {
  return sha256Hex(`${prevHash}|${seq}|${deals.map(dealCanonical).join(";")}`);
}
