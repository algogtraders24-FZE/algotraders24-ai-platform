// app/api/private/broker/status/route.ts
// GET -> the connected MetaTrader account (Phase 1: the owner's one account, admin only): balance, equity, open positions, pending orders and the
// safety flags. Read-only; never sends an order.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { getAccountInformation, getOrders, getPositions, isLiveAccount, maskLogin, upstreamStatus, readConfig } from "@/lib/broker/metaapi";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const cfg = readConfig();
  if (!cfg) return ApiResponse.success({ configured: false }, ctx.requestId, 200, ctx.startedAt);
  try {
    const [info, positions, orders] = await Promise.all([getAccountInformation(cfg), getPositions(cfg), getOrders(cfg)]);
    return ApiResponse.success(
      {
        configured: true,
        tradingEnabled: cfg.tradingEnabled,
        live: isLiveAccount(info),
        liveAllowed: cfg.allowLive,
        maxLots: cfg.maxLots,
        symbolSuffix: cfg.symbolSuffix,
        account: { broker: info.broker, server: info.server, currency: info.currency, balance: info.balance, equity: info.equity, freeMargin: info.freeMargin, leverage: info.leverage, login: maskLogin(info.login), type: info.type, tradeAllowed: info.tradeAllowed },
        positions: Array.isArray(positions) ? positions : [],
        orders: Array.isArray(orders) ? orders : [],
      },
      ctx.requestId, 200, ctx.startedAt,
    );
  } catch (e) {
    const timedOut = upstreamStatus(e) === 504;
    return ApiResponse.success(
      { configured: true, unavailable: true, message: timedOut ? "MetaApi did not answer in time. The MetaApi account is probably not connected to the broker (check its login, password and server in MetaApi)." : e instanceof Error ? e.message : "Broker connection failed." },
      ctx.requestId, 200, ctx.startedAt,
    );
  }
});
