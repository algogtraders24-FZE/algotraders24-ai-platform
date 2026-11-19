// app/api/private/market-data/quote/route.ts
// GET ?symbol=US30 -> { bid, ask, asOf } for an instrument the Exness account lists (read from the Exness Trading API, read-only).
// Used by the Pro Chart's bid / ask strip for instruments outside the registry's enabled markets. Signed-in users only.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getSharedExnessClient } from "@/lib/market-data/exness-api";
import { listExnessInstruments } from "@/lib/market-data/exness-instruments";

export const dynamic = "force-dynamic";

const CACHE_MS = 5_000;
const cache = new Map<string, { at: number; bid: number; ask: number; asOf: string }>();

export const GET = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const symbol = (new URL(req.url).searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z0-9._#-]{2,20}$/.test(symbol)) return ApiResponse.error({ code: "VALIDATION", message: "symbol is required." }, ctx.requestId, 400, ctx.startedAt);
  const client = getSharedExnessClient();
  if (!client.isEnabled()) return ApiResponse.error({ code: "UNAVAILABLE", message: "Live quotes are not configured." }, ctx.requestId, 503, ctx.startedAt);
  if (!(await listExnessInstruments()).some((i) => i.symbol === symbol)) {
    return ApiResponse.error({ code: "VALIDATION", message: "Unknown instrument." }, ctx.requestId, 400, ctx.startedAt);
  }
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_MS) return ApiResponse.success({ bid: hit.bid, ask: hit.ask, asOf: hit.asOf }, ctx.requestId, 200, ctx.startedAt);
  try {
    const q = await client.getQuote(symbol);
    cache.set(symbol, { at: Date.now(), bid: q.bid, ask: q.ask, asOf: q.providerTimestamp });
    return ApiResponse.success({ bid: q.bid, ask: q.ask, asOf: q.providerTimestamp }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "No live quote right now." }, ctx.requestId, 503, ctx.startedAt);
  }
});
