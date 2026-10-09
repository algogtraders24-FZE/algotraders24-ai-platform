// app/api/private/telegram/route.ts
// The signed-in user's own Telegram connection (session-authenticated; every query is scoped to the session user).
//   GET                     status: { configured, botUsername, linked, username, alertsOn, watchOn }
//   POST {action:"link"}    creates a one-time code and returns the deep link https://t.me/<bot>?start=<code> (15 minutes, single use)
//   POST {action:"prefs", alertsOn?, watchOn?}   switch the two kinds on/off
//   POST {action:"test"}    sends a test message to the linked chat
//   DELETE                  disconnects
// Alerts only inform; nothing here trades or touches an account.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { telegramConfig } from "@/services/telegram/config";
import { createTelegramClient } from "@/services/telegram/client";
import { LINK_CODE_TTL_MS, newLinkCode, prismaTelegramStore } from "@/services/telegram/store";
import { testMessage } from "@/services/telegram/messages";

export const dynamic = "force-dynamic";

const off = (ctx: { requestId: string; startedAt: number }) => ApiResponse.error({ code: "UNAVAILABLE", message: "Telegram alerts are not switched on yet." }, ctx.requestId, 503, ctx.startedAt);

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const cfg = telegramConfig();
  if (!cfg.enabled || !cfg.botUsername) return ApiResponse.success({ configured: false }, ctx.requestId, 200, ctx.startedAt);
  try {
    const link = await prismaTelegramStore().getByUser(user.profile.id);
    return ApiResponse.success(
      { configured: true, botUsername: cfg.botUsername, linked: link !== null, username: link?.username ?? null, alertsOn: link?.alertsOn ?? true, watchOn: link?.watchOn ?? true, linkedAt: link?.linkedAt ?? null },
      ctx.requestId,
      200,
      ctx.startedAt,
    );
  } catch {
    return off(ctx);
  }
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const cfg = telegramConfig();
  if (!cfg.enabled || !cfg.botUsername) return off(ctx);
  const body = (await req.json().catch(() => null)) as { action?: unknown; alertsOn?: unknown; watchOn?: unknown } | null;
  const store = prismaTelegramStore();
  try {
    if (body?.action === "link") {
      const { code, hash } = newLinkCode();
      await store.createCode(user.profile.id, hash, new Date(Date.now() + LINK_CODE_TTL_MS));
      return ApiResponse.success({ url: `https://t.me/${cfg.botUsername}?start=${code}`, expiresInMin: Math.round(LINK_CODE_TTL_MS / 60_000) }, ctx.requestId, 200, ctx.startedAt);
    }
    if (body?.action === "prefs") {
      const prefs: { alertsOn?: boolean; watchOn?: boolean } = {};
      if (typeof body.alertsOn === "boolean") prefs.alertsOn = body.alertsOn;
      if (typeof body.watchOn === "boolean") prefs.watchOn = body.watchOn;
      if (Object.keys(prefs).length === 0) return ApiResponse.error({ code: "BAD_REQUEST", message: "alertsOn or watchOn must be true or false" }, ctx.requestId, 400, ctx.startedAt);
      const ok = await store.setPrefs(user.profile.id, prefs);
      if (!ok) return ApiResponse.error({ code: "NOT_FOUND", message: "Telegram is not connected" }, ctx.requestId, 404, ctx.startedAt);
      return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
    }
    if (body?.action === "test") {
      const link = await store.getByUser(user.profile.id);
      if (!link) return ApiResponse.error({ code: "NOT_FOUND", message: "Telegram is not connected" }, ctx.requestId, 404, ctx.startedAt);
      const res = await createTelegramClient(cfg.token).sendMessage(link.chatId, testMessage(cfg.siteUrl));
      if (res.gone) await store.unlinkByUser(user.profile.id);
      if (!res.ok) return ApiResponse.error({ code: "DELIVERY_FAILED", message: res.gone ? "Telegram says the chat is gone, so it was disconnected. Connect again." : "Telegram did not accept the message. Try again in a minute." }, ctx.requestId, 502, ctx.startedAt);
      return ApiResponse.success({ sent: true }, ctx.requestId, 200, ctx.startedAt);
    }
    return ApiResponse.error({ code: "BAD_REQUEST", message: 'action must be "link", "prefs" or "test"' }, ctx.requestId, 400, ctx.startedAt);
  } catch {
    return off(ctx);
  }
});

export const DELETE = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  if (!telegramConfig().enabled) return off(ctx);
  try {
    await prismaTelegramStore().unlinkByUser(user.profile.id);
    return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return off(ctx);
  }
});
