// app/api/private/exec/orders/route.ts
// The user's side of the Execute bridge (session-authenticated; admin-only until EXEC_BRIDGE_PUBLIC=true).
//   GET     -> { enabled, connected, maxLots, pollSec, orders }  (the user's recent orders with their status)
//   POST    -> queues ONE order the user confirmed ({ symbol, side, kind, volume, price?, stopLoss, takeProfit?, clientNonce, confirm: true, ... })
//   DELETE ?id=... -> cancels a still-queued order
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prismaExecStore } from "@/services/exec-bridge/prisma-store";
import { ExecOrderService } from "@/services/exec-bridge/service";
import { EXEC, canUseExec, execMaxLots } from "@/services/exec-bridge/config";

export const dynamic = "force-dynamic";
const service = new ExecOrderService(prismaExecStore);

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!canUseExec(user.profile.role)) return ApiResponse.success({ enabled: false }, ctx.requestId, 200, ctx.startedAt);
  try {
    const [orders, connected] = await Promise.all([service.list(user.profile.id, 20), service.connected(user.profile.id)]);
    return ApiResponse.success({ enabled: true, connected, maxLots: execMaxLots(), pollSec: EXEC.pollSec, orders }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.success({ enabled: false, unavailable: true }, ctx.requestId, 200, ctx.startedAt);
  }
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!canUseExec(user.profile.role)) return ApiResponse.error({ code: "NOT_AVAILABLE", message: "The execute bridge is not open to your account yet." }, ctx.requestId, 403, ctx.startedAt);
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  try {
    const r = await service.create(user.profile.id, body);
    if (!r.ok) return ApiResponse.error({ code: r.code, message: r.message }, ctx.requestId, r.code === "RATE_LIMITED" ? 429 : r.code === "VALIDATION" ? 400 : 409, ctx.startedAt);
    return ApiResponse.success({ order: r.order, created: r.created }, ctx.requestId, r.created ? 201 : 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "The execute bridge is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});

export const DELETE = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return ApiResponse.error({ code: "BAD_REQUEST", message: "id is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const ok = await service.cancel(user.profile.id, id);
    if (!ok) return ApiResponse.error({ code: "NOT_FOUND", message: "No queued order with that id" }, ctx.requestId, 404, ctx.startedAt);
    return ApiResponse.success({ cancelled: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "The execute bridge is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
