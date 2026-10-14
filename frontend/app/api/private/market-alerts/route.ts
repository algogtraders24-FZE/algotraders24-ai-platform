// app/api/private/market-alerts/route.ts
// The signed-in user's market alert rules (session-authenticated; every query is scoped to the user id).
//   GET   the 3 alert types for each of the 7 instruments with the saved settings (defaults where none saved)
//   PUT   body {symbol, kind, enabled, threshold?}   save one rule (re-arms it)
//   POST  send a TEST alert to the bell (and Telegram / push if connected) to confirm delivery
// Alerts only inform; nothing here trades.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { MARKET_ALERT_INFO, MARKET_ALERT_KINDS, SYMBOL_LABEL, validateMarketRuleInput } from "@/services/market-alerts/alerts";
import { createNotification } from "@/services/notifications/NotificationService";
import { sendTelegramToUser } from "@/services/telegram/deliver";
import { sendPushToUser } from "@/services/push/deliver";
import { alertMessage } from "@/services/telegram/messages";
import { telegramConfig } from "@/services/telegram/config";

export const dynamic = "force-dynamic";

const SYMBOLS = Object.keys(SYMBOL_LABEL);
const MAX_RULES_PER_USER = SYMBOLS.length * MARKET_ALERT_KINDS.length;

const unavailable = (ctx: { requestId: string; startedAt: number }) =>
  ApiResponse.error({ code: "UNAVAILABLE", message: "Market alerts are not available yet." }, ctx.requestId, 503, ctx.startedAt);
const unauthorized = (ctx: { requestId: string; startedAt: number }) =>
  ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return unauthorized(ctx);
  try {
    const saved = await prisma.marketAlertRule.findMany({ where: { userId: user.profile.id } });
    const by = new Map(saved.map((r) => [`${r.symbol}:${r.kind}`, r]));
    return ApiResponse.success(
      {
        kinds: MARKET_ALERT_KINDS.map((k) => ({ kind: k, label: MARKET_ALERT_INFO[k].label, unit: MARKET_ALERT_INFO[k].unit, help: MARKET_ALERT_INFO[k].help, options: MARKET_ALERT_INFO[k].options, defaultThreshold: MARKET_ALERT_INFO[k].defaultThreshold })),
        symbols: SYMBOLS.map((symbol) => ({
          symbol,
          label: SYMBOL_LABEL[symbol],
          rules: MARKET_ALERT_KINDS.map((kind) => {
            const r = by.get(`${symbol}:${kind}`);
            return { kind, enabled: r?.enabled ?? false, threshold: r?.threshold ?? MARKET_ALERT_INFO[kind].defaultThreshold, state: r?.state ?? "ok" };
          }),
        })),
      },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch {
    return unavailable(ctx);
  }
});

export const PUT = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return unauthorized(ctx);
  const v = validateMarketRuleInput(await req.json().catch(() => null), SYMBOLS);
  if (!v.ok) return ApiResponse.error({ code: "VALIDATION", message: v.message }, ctx.requestId, 400, ctx.startedAt);
  try {
    const count = await prisma.marketAlertRule.count({ where: { userId: user.profile.id } });
    const exists = await prisma.marketAlertRule.findUnique({ where: { userId_symbol_kind: { userId: user.profile.id, symbol: v.value.symbol, kind: v.value.kind } }, select: { id: true } });
    if (!exists && count >= MAX_RULES_PER_USER) return ApiResponse.error({ code: "LIMIT", message: "Rule limit reached." }, ctx.requestId, 400, ctx.startedAt);
    const row = await prisma.marketAlertRule.upsert({
      where: { userId_symbol_kind: { userId: user.profile.id, symbol: v.value.symbol, kind: v.value.kind } },
      create: { userId: user.profile.id, symbol: v.value.symbol, kind: v.value.kind, threshold: v.value.threshold, enabled: v.value.enabled, cooldownMin: MARKET_ALERT_INFO[v.value.kind].defaultCooldownMin },
      update: { threshold: v.value.threshold, enabled: v.value.enabled, state: "ok" },
    });
    return ApiResponse.success({ symbol: row.symbol, kind: row.kind, enabled: row.enabled, threshold: row.threshold }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});

export const POST = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return unauthorized(ctx);
  const title = "AT24 test alert";
  const body = "This is how your market alerts will look. An information alert only - not a trade call.";
  await createNotification({ userId: user.profile.id, kind: "market_alert", severity: "info", title, body, href: "/dashboard/alerts" }).catch(() => undefined);
  const telegram = await sendTelegramToUser(user.profile.id, "alerts", alertMessage({ title, body, href: "/dashboard/alerts", siteUrl: telegramConfig().siteUrl })).catch(() => false);
  const push = await sendPushToUser(user.profile.id, "alerts", { title, body, url: "/dashboard/alerts", tag: "ma-test" }).catch(() => 0);
  return ApiResponse.success({ bell: true, telegram, push: push > 0 }, ctx.requestId, 200, ctx.startedAt);
});
