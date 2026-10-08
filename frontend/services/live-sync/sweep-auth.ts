// services/live-sync/sweep-auth.ts
// Bearer check for the offline-alert timer endpoint. Pure. Accepts the dedicated LIVE_SYNC_SWEEP_SECRET
// (preferred: the VPS then never holds the Vercel cron secret) or the platform CRON_SECRET.
// Secrets shorter than 16 characters are ignored (a weak or missing secret never authorizes anything).

import { timingSafeEqual } from "node:crypto";

export const MIN_SECRET_LENGTH = 16;

export function sweepAuthorized(authorizationHeader: string | null, secrets: readonly (string | undefined)[]): boolean {
  const given = Buffer.from((authorizationHeader ?? "").replace(/^Bearer\s+/i, ""));
  let ok = false;
  for (const s of secrets) {
    if (!s || s.length < MIN_SECRET_LENGTH) continue;
    const b = Buffer.from(s);
    // Compare against every configured secret (no early exit) so timing does not reveal which one matched.
    if (given.length === b.length && timingSafeEqual(given, b)) ok = true;
  }
  return ok;
}
