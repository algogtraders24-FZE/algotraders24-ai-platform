// app/api/private/push/route.ts
// The signed-in user's own Web Push devices (session-authenticated; every query is scoped to the session user).
//   GET [?endpoint=...]         { configured, publicKey, devices, subscribed, alertsOn, watchOn } (the last three for that endpoint)
//   POST {action:"subscribe", subscription}          register this device (the browser's PushSubscription JSON)
//   POST {action:"prefs", endpoint, alertsOn?, watchOn?}
//   POST {action:"test"}                             sends a test notification to all this user's devices
//   DELETE {endpoint}                                turn notifications off for that device
// The endpoint must be an https address of a real push service (SSRF guard in services/push/subscription.ts).
// Notifications only inform; nothing here trades or touches an account.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { pushConfig } from "@/services/push/config";
import { prismaPushStore } from "@/services/push/store";
import { isAllowedPushEndpoint, parseSubscription } from "@/services/push/subscription";
import { sendPushToUser } from "@/services/push/deliver";

export const dynamic = "force-dynamic";

const off = (ctx: { requestId: string; startedAt: number }) => ApiResponse.error({ code: "UNAVAILABLE", message: "Push notifications are not switched on yet." }, ctx.requestId, 503, ctx.startedAt);
const unauth = (ctx: { requestId: string; startedAt: number }) => ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);

export const GET = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return unauth(ctx);
  const cfg = pushConfig();
  if (!cfg.enabled) return ApiResponse.success({ configured: false }, ctx.requestId, 200, ctx.startedAt);
  try {
    const subs = await prismaPushStore().listByUser(user.profile.id);
    const endpoint = new URL(req.url).searchParams.get("endpoint");
    const mine = endpoint ? subs.find((s) => s.endpoint === endpoint) : undefined;
    return ApiResponse.success({ configured: true, publicKey: cfg.publicKey, devices: subs.length, subscribed: mine !== undefined, alertsOn: mine?.alertsOn ?? true, watchOn: mine?.watchOn ?? true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return off(ctx);
  }
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return unauth(ctx);
  if (!pushConfig().enabled) return off(ctx);
  const body = (await req.json().catch(() => null)) as { action?: unknown; subscription?: unknown; endpoint?: unknown; alertsOn?: unknown; watchOn?: unknown } | null;
  const store = prismaPushStore();
  try {
    if (body?.action === "subscribe") {
      const sub = parseSubscription(body.subscription);
      if (typeof sub === "string") return ApiResponse.error({ code: "BAD_REQUEST", message: sub }, ctx.requestId, 400, ctx.startedAt);
      await store.upsert(user.profile.id, sub, req.headers.get("user-agent"));
      return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
    }
    if (body?.action === "prefs") {
      if (!isAllowedPushEndpoint(body.endpoint)) return ApiResponse.error({ code: "BAD_REQUEST", message: "endpoint is required" }, ctx.requestId, 400, ctx.startedAt);
      const prefs: { alertsOn?: boolean; watchOn?: boolean } = {};
      if (typeof body.alertsOn === "boolean") prefs.alertsOn = body.alertsOn;
      if (typeof body.watchOn === "boolean") prefs.watchOn = body.watchOn;
      if (Object.keys(prefs).length === 0) return ApiResponse.error({ code: "BAD_REQUEST", message: "alertsOn or watchOn must be true or false" }, ctx.requestId, 400, ctx.startedAt);
      const ok = await store.setPrefs(user.profile.id, body.endpoint as string, prefs);
      if (!ok) return ApiResponse.error({ code: "NOT_FOUND", message: "This device is not subscribed" }, ctx.requestId, 404, ctx.startedAt);
      return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
    }
    if (body?.action === "test") {
      const n = await sendPushToUser(user.profile.id, "alerts", { title: "AT24 test notification", body: "Notifications are on for this device. Your Live Sync alerts will arrive like this.", url: "/dashboard/live-sync", tag: "at24-test" });
      if (n === 0) return ApiResponse.error({ code: "DELIVERY_FAILED", message: "No device accepted the notification. Make sure notifications are allowed for this site, then try again." }, ctx.requestId, 502, ctx.startedAt);
      return ApiResponse.success({ sent: n }, ctx.requestId, 200, ctx.startedAt);
    }
    return ApiResponse.error({ code: "BAD_REQUEST", message: 'action must be "subscribe", "prefs" or "test"' }, ctx.requestId, 400, ctx.startedAt);
  } catch {
    return off(ctx);
  }
});

export const DELETE = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return unauth(ctx);
  if (!pushConfig().enabled) return off(ctx);
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (!isAllowedPushEndpoint(body?.endpoint)) return ApiResponse.error({ code: "BAD_REQUEST", message: "endpoint is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    await prismaPushStore().removeByEndpoint(user.profile.id, body!.endpoint as string);
    return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return off(ctx);
  }
});
