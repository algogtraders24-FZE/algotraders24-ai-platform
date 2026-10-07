// services/live-sync/auth.ts
// AT24 Live Sync (P1) - device-token authentication. Storage injected. Fails
// closed (unknown / revoked / inactive user / store error -> null) and never says
// why. The token only authorizes WRITING the owner's own sync data.

import { hashSyncToken, parseSyncBearer } from "./crypto";

export interface DeviceRecord {
  id: string;
  userId: string;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
  /** Owner's account status; "active" required. */
  userStatus: string;
}

export interface DeviceStore {
  findByHash(tokenHash: string): Promise<DeviceRecord | null>;
  touch(deviceId: string, at: Date): Promise<void>;
}

export interface DevicePrincipal {
  deviceId: string;
  userId: string;
}

export const TOUCH_INTERVAL_MS = 60_000;
export const TOUCH_TIMEOUT_MS = 1_500;

/** Awaited (serverless freezes un-awaited work) but bounded and failure-proof. */
async function touchBounded(store: DeviceStore, id: string, at: Date): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([store.touch(id, at).catch(() => undefined), new Promise<void>((r) => { timer = setTimeout(r, TOUCH_TIMEOUT_MS); })]);
  } catch {
    // bookkeeping can never break authentication
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function authenticateDevice(store: DeviceStore, authorization: string | null | undefined, now: Date = new Date()): Promise<DevicePrincipal | null> {
  const raw = parseSyncBearer(authorization);
  if (!raw) return null;
  let rec: DeviceRecord | null;
  try {
    rec = await store.findByHash(hashSyncToken(raw));
  } catch {
    return null;
  }
  if (!rec || rec.revokedAt || rec.userStatus !== "active") return null;
  if (!rec.lastSeenAt || now.getTime() - rec.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) await touchBounded(store, rec.id, now);
  return { deviceId: rec.id, userId: rec.userId };
}
