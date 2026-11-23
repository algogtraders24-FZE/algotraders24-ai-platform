// services/exec-bridge/handler.ts
// The EA-facing HTTP layer: POST /api/exec/v1/poll and /api/exec/v1/report. Stateless. Gates, cheapest first, every one fails closed:
//   enabled flag -> method -> body size -> JSON -> device token -> rate limit -> logic. Bodies and headers are never logged.
import { EXEC } from "./config";
import { hashExecToken, parseExecBearer } from "./token";
import { parseExecReport } from "./rules";
import type { ExecStore } from "./store";

export interface ExecHttpDeps {
  enabled: boolean;
  store: ExecStore;
  burst?: { allow(key: string): boolean };
  now?: () => Date;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}
const error = (status: number, code: string, message: string, headers: Record<string, string> = {}) => json(status, { ok: false, code, message }, headers);

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > EXEC.maxBodyBytes) return { ok: false, response: error(413, "TOO_LARGE", "Request too large.") };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: error(400, "BAD_BODY", "Unreadable body.") };
  }
  if (text.length > EXEC.maxBodyBytes) return { ok: false, response: error(413, "TOO_LARGE", "Request too large.") };
  if (text.trim() === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: error(400, "BAD_JSON", "Body must be valid JSON.") };
  }
}

async function authenticate(store: ExecStore, header: string | null, now: Date): Promise<{ deviceId: string; userId: string } | null> {
  const raw = parseExecBearer(header);
  if (!raw) return null;
  try {
    const rec = await store.deviceByHash(hashExecToken(raw));
    if (!rec || rec.revokedAt || rec.userStatus !== "active") return null;
    // an EA that polls every few seconds must not write on every poll: touch at most once every 20 s
    if (!rec.lastSeenAt || now.getTime() - rec.lastSeenAt.getTime() >= 20_000) await store.touchDevice(rec.id, now).catch(() => undefined);
    return { deviceId: rec.id, userId: rec.userId };
  } catch {
    return null;
  }
}

export async function handleExecRequest(request: Request, route: "poll" | "report", deps: ExecHttpDeps): Promise<Response> {
  if (!deps.enabled) return error(503, "DISABLED", "The execute bridge is not switched on.");
  if (request.method !== "POST") return error(405, "METHOD", "Use POST.", { allow: "POST" });

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const now = deps.now?.() ?? new Date();
  const principal = await authenticate(deps.store, request.headers.get("authorization"), now);
  if (!principal) return error(401, "UNAUTHORIZED", "Authentication required.", { "www-authenticate": 'Bearer realm="at24-exec"' });
  if (deps.burst && !deps.burst.allow(principal.deviceId)) return error(429, "RATE_LIMITED", "Too many requests.", { "retry-after": "10" });

  try {
    if (route === "poll") {
      await deps.store.expireDue(principal.userId, now);
      const o = await deps.store.claimNext(principal.userId, principal.deviceId, now);
      return json(200, {
        ok: true,
        serverTime: now.toISOString(),
        pollSec: EXEC.pollSec,
        order: o
          ? { id: o.id, symbol: o.symbol, side: o.side, kind: o.kind, volume: o.volume, price: o.price, stopLoss: o.stopLoss, takeProfit: o.takeProfit, expiresAt: o.expiresAt.toISOString() }
          : null,
      });
    }
    const parsed = parseExecReport(body.value);
    if (!parsed.ok) return error(400, "VALIDATION", parsed.message);
    const result = await deps.store.applyReport(principal.userId, parsed.value, now);
    if (result === "not_found") return error(404, "NOT_FOUND", "Unknown order.");
    if (result === "bad_state") return error(409, "BAD_STATE", "This order is not waiting for a result.");
    return json(200, { ok: true });
  } catch {
    return error(500, "INTERNAL", "Could not process the request.");
  }
}
