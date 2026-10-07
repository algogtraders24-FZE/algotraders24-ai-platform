// services/live-sync/handler.ts
// AT24 Live Sync (P1) - the HTTP layer for /api/live-sync/v1/{handshake,ingest}.
// Stateless. Gates, cheapest first, every one fails closed:
//   enabled flag -> method -> body size -> JSON -> device token -> rate limit -> logic.
// Bodies/headers are never logged; responses never echo submitted data.

import { LIMITS } from "./contract";
import { accountSaltFor } from "./crypto";
import { authenticateDevice, type DeviceStore } from "./auth";
import { processIngest, type LiveSyncStore } from "./ingest";

export interface LiveSyncHttpDeps {
  /** Master switch (env LIVE_SYNC_ENABLED === "true"). Off => 503. */
  enabled: boolean;
  deviceStore: DeviceStore;
  store: LiveSyncStore;
  burst?: { allow(key: string): boolean };
  now?: () => Date;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}
const error = (status: number, code: string, message: string, headers: Record<string, string> = {}) => json(status, { ok: false, code, message }, headers);

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > LIMITS.maxBodyBytes) return { ok: false, response: error(413, "TOO_LARGE", "Request too large.") };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: error(400, "BAD_BODY", "Unreadable body.") };
  }
  if (text.length > LIMITS.maxBodyBytes) return { ok: false, response: error(413, "TOO_LARGE", "Request too large.") };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: error(400, "BAD_JSON", "Body must be valid JSON.") };
  }
}

export async function handleLiveSyncRequest(request: Request, route: "handshake" | "ingest", deps: LiveSyncHttpDeps): Promise<Response> {
  if (!deps.enabled) return error(503, "DISABLED", "Live Sync is temporarily unavailable.");
  if (request.method !== "POST") return error(405, "METHOD", "Use POST.", { allow: "POST" });

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const now = deps.now?.() ?? new Date();
  const principal = await authenticateDevice(deps.deviceStore, request.headers.get("authorization"), now);
  if (!principal) return error(401, "UNAUTHORIZED", "Authentication required.", { "www-authenticate": 'Bearer realm="at24-live-sync"' });

  if (deps.burst && !deps.burst.allow(principal.deviceId)) return error(429, "RATE_LIMITED", "Too many requests.", { "retry-after": "30" });

  if (route === "handshake") {
    return json(200, {
      ok: true,
      accountSalt: accountSaltFor(principal.userId),
      minIntervalSec: LIMITS.minIntervalSec,
      maxBatchDeals: LIMITS.maxDealsPerBatch,
      serverTime: now.toISOString(),
    });
  }

  try {
    const outcome = await processIngest(deps.store, principal.userId, body.value, now);
    return json(outcome.status, outcome.body);
  } catch {
    return error(500, "INTERNAL", "Could not process the request.");
  }
}
