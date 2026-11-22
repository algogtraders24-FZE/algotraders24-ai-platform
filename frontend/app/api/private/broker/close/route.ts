// app/api/private/broker/close/route.ts
// POST { positionId, confirm: true } -> closes ONE open position. Admin only; same read-only / live / confirm guards as the order route.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import type { HttpStatusCode } from "@/types/api";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { closePosition, getAccountInformation, isLiveAccount, upstreamStatus, readConfig, tradeSucceeded } from "@/lib/broker/metaapi";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const err = (code: string, message: string, status: HttpStatusCode) => ApiResponse.error({ code, message }, ctx.requestId, status, ctx.startedAt);

  const cfg = readConfig();
  if (!cfg) return err("NOT_CONFIGURED", "The broker connection is not configured.", 503);
  if (!cfg.tradingEnabled) return err("TRADING_DISABLED", "Order sending is switched off (read-only mode).", 403);

  let body: { positionId?: unknown; confirm?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  if (body.confirm !== true) return err("NOT_CONFIRMED", "The close was not confirmed by the user.", 400);
  if (typeof body.positionId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(body.positionId)) return err("VALIDATION", "Invalid position id.", 400);

  try {
    const info = await getAccountInformation(cfg);
    if (isLiveAccount(info) && !cfg.allowLive) return err("LIVE_BLOCKED", "This is a live account and live orders are not enabled.", 403);
    const result = await closePosition(cfg, body.positionId);
    if (!tradeSucceeded(result)) return err("REJECTED", result.message ?? "The broker rejected the close request.", 422);
    return ApiResponse.success({ ok: true, message: result.message }, ctx.requestId, 200, ctx.startedAt);
  } catch (e) {
    return err("BROKER_UNAVAILABLE", e instanceof Error ? e.message : "Broker connection failed.", upstreamStatus(e));
  }
});
