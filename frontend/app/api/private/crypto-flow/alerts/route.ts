// app/api/private/crypto-flow/alerts/route.ts
// The signed-in member's Flow Zones Telegram alerts (session-authenticated; every query is scoped to the session user).
//   GET                              { configured, linked, symbols: [subscribed instruments] }
//   POST { symbol, enabled: boolean }  subscribe / unsubscribe one instrument (needs a linked Telegram chat)
// The message goes to the chat linked in Live Sync, through the same "alerts" switch. Alerts only inform.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { telegramConfig } from "@/services/telegram/config";
import { prismaTelegramStore } from "@/services/telegram/store";
import { isCryptoFlowSymbol } from "@/types/crypto-flow";

export const dynamic = "force-dynamic";
const MAX_SUBSCRIPTIONS = 6;

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const cfg = telegramConfig();
  if (!cfg.enabled) return ApiResponse.success({ configured: false, linked: false, symbols: [] }, ctx.requestId, 200, ctx.startedAt);
  const [link, subs] = await Promise.all([prismaTelegramStore().getByUser(user.profile.id), prisma.flowZoneAlertSub.findMany({ where: { userId: user.profile.id }, select: { symbol: true } })]);
  return ApiResponse.success({ configured: true, linked: link !== null, symbols: subs.map((s) => s.symbol) }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const body = (await req.json().catch(() => null)) as { symbol?: unknown; enabled?: unknown } | null;
  const symbol = typeof body?.symbol === "string" ? body.symbol.toUpperCase() : "";
  if (!isCryptoFlowSymbol(symbol) || typeof body?.enabled !== "boolean") {
    return ApiResponse.error({ code: "VALIDATION", message: "symbol (a Crypto Flow instrument) and enabled (true/false) are required" }, ctx.requestId, 400, ctx.startedAt);
  }
  const userId = user.profile.id;
  if (!body.enabled) {
    await prisma.flowZoneAlertSub.deleteMany({ where: { userId, symbol } });
    return ApiResponse.success({ symbol, enabled: false }, ctx.requestId, 200, ctx.startedAt);
  }
  if (!telegramConfig().enabled) return ApiResponse.error({ code: "UNAVAILABLE", message: "Telegram alerts are not switched on yet." }, ctx.requestId, 503, ctx.startedAt);
  const link = await prismaTelegramStore().getByUser(userId);
  if (!link) return ApiResponse.error({ code: "NOT_LINKED", message: "Connect Telegram first (Live Sync > Connect Telegram)." }, ctx.requestId, 409, ctx.startedAt);
  const count = await prisma.flowZoneAlertSub.count({ where: { userId } });
  const exists = await prisma.flowZoneAlertSub.findUnique({ where: { userId_symbol: { userId, symbol } }, select: { id: true } });
  if (!exists && count >= MAX_SUBSCRIPTIONS) {
    return ApiResponse.error({ code: "LIMIT", message: `You can follow up to ${MAX_SUBSCRIPTIONS} instruments.` }, ctx.requestId, 409, ctx.startedAt);
  }
  await prisma.flowZoneAlertSub.upsert({ where: { userId_symbol: { userId, symbol } }, create: { userId, symbol }, update: {} });
  return ApiResponse.success({ symbol, enabled: true }, ctx.requestId, 200, ctx.startedAt);
});
