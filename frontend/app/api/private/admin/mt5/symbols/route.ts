// app/api/private/admin/mt5/symbols/route.ts
// Admin-only, read-only diagnostic: asks the MT5 bridge (server-side, with the
// shared secret from the environment - never exposed) which symbols the Exness
// terminal offers, and sorts them into the groups we would map next (dollar
// index, stock indices, oil, volatility, yields). Used to choose real symbol
// names for the bridge's SYMBOL_MAP; it changes nothing.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { loadMt5BridgeEnv } from "@/lib/market-data/env";
import { groupMt5Symbols } from "@/services/market-data/mt5-symbol-groups";

export const maxDuration = 30;

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const env = loadMt5BridgeEnv();
  if (!env) {
    return ApiResponse.error({ code: "NOT_CONFIGURED", message: "MT5 bridge is not configured on this deployment" }, ctx.requestId, 503, ctx.startedAt);
  }
  try {
    const res = await fetch(`${env.bridgeUrl}/symbols`, { headers: { Authorization: `Bearer ${env.secret}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return ApiResponse.error({ code: "BRIDGE_ERROR", message: `Bridge answered HTTP ${res.status}` }, ctx.requestId, 502, ctx.startedAt);
    }
    const body = (await res.json()) as { count?: number; symbols?: unknown };
    const names = Array.isArray(body.symbols) ? body.symbols.filter((s): s is string => typeof s === "string") : [];
    const all = new URL(req.url).searchParams.get("all") === "1";
    return ApiResponse.success({ ...groupMt5Symbols(names), ...(all ? { all: names } : {}) }, ctx.requestId, 200, ctx.startedAt);
  } catch (err) {
    return ApiResponse.error({ code: "BRIDGE_UNREACHABLE", message: err instanceof Error ? err.message : "bridge unreachable" }, ctx.requestId, 502, ctx.startedAt);
  }
});
