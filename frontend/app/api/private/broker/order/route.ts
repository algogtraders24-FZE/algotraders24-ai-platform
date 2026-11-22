// app/api/private/broker/order/route.ts
// POST { symbol, side, kind, volume, price?, stopLoss, takeProfit?, confirm: true } -> sends ONE order to the connected MetaTrader account.
// Admin only (Phase 1). Blocked unless METAAPI_TRADING_ENABLED=true, blocked on a LIVE account unless METAAPI_ALLOW_LIVE=true, a stop loss is
// mandatory, volume is capped (METAAPI_MAX_LOTS), and `confirm` must be literally true (the UI sets it only after the user presses Confirm).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import type { HttpStatusCode } from "@/types/api";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { getAccountInformation, isLiveAccount, upstreamStatus, placeOrder, readConfig, tradeSucceeded, validateOrder, type OrderRequest } from "@/lib/broker/metaapi";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const err = (code: string, message: string, status: HttpStatusCode) => ApiResponse.error({ code, message }, ctx.requestId, status, ctx.startedAt);

  const cfg = readConfig();
  if (!cfg) return err("NOT_CONFIGURED", "The broker connection is not configured.", 503);
  if (!cfg.tradingEnabled) return err("TRADING_DISABLED", "Order sending is switched off (read-only mode).", 403);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { body = {}; }
  if (body.confirm !== true) return err("NOT_CONFIRMED", "The order was not confirmed by the user.", 400);

  const order: OrderRequest = {
    symbol: typeof body.symbol === "string" ? body.symbol : "",
    side: body.side as OrderRequest["side"],
    kind: body.kind as OrderRequest["kind"],
    volume: num(body.volume) ?? 0,
    price: num(body.price),
    stopLoss: num(body.stopLoss),
    takeProfit: num(body.takeProfit),
  };
  const problem = validateOrder(order, cfg.maxLots);
  if (problem) return err("VALIDATION", problem, 400);

  try {
    const info = await getAccountInformation(cfg);
    if (isLiveAccount(info) && !cfg.allowLive) return err("LIVE_BLOCKED", "This is a live account and live orders are not enabled.", 403);
    const result = await placeOrder(cfg, order);
    if (!tradeSucceeded(result)) return err("REJECTED", result.message ?? "The broker rejected the order.", 422);
    return ApiResponse.success({ ok: true, orderId: result.orderId, positionId: result.positionId, message: result.message }, ctx.requestId, 200, ctx.startedAt);
  } catch (e) {
    return err("BROKER_UNAVAILABLE", upstreamStatus(e) === 504 ? "MetaApi did not answer in time; the account may not be connected to the broker." : e instanceof Error ? e.message : "Broker connection failed.", 409);
  }
});
