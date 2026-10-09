// app/api/private/live-sync/alerts/route.ts
// Alert rules of one synced account (session-authenticated; the account must belong to the user).
//   GET  ?accountId=...                 the 5 alert types with the saved settings (defaults where none saved)
//   PUT  body {accountId, kind, threshold, enabled, notifyEmail, notifyBell, cooldownMin}   save one rule
//   POST body {accountId}               send a TEST alert (bell + email) to confirm delivery
// Alerts only inform; nothing here trades or closes positions.

import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { ALERT_KINDS, KIND_INFO, validateRuleInput } from "@/services/live-sync/alerts";
import { createNotification } from "@/services/notifications/NotificationService";
import { sendLiveSyncAlertEmail } from "@/services/notifications/EmailService";
import { sendTelegramToUser } from "@/services/telegram/deliver";
import { alertMessage } from "@/services/telegram/messages";
import { telegramConfig } from "@/services/telegram/config";

export const dynamic = "force-dynamic";

const unavailable = (ctx: { requestId: string; startedAt: number }) =>
  ApiResponse.error({ code: "UNAVAILABLE", message: "Alerts are not available yet." }, ctx.requestId, 503, ctx.startedAt);

async function ownedAccount(userId: string, accountId: string) {
  return prisma.liveSyncAccount.findFirst({ where: { id: accountId, userId }, select: { id: true, accountKey: true } });
}

export const GET = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId) return ApiResponse.error({ code: "BAD_REQUEST", message: "accountId is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    if (!(await ownedAccount(user.profile.id, accountId))) return ApiResponse.error({ code: "NOT_FOUND", message: "Account not found" }, ctx.requestId, 404, ctx.startedAt);
    const saved = await prisma.liveSyncAlertRule.findMany({ where: { accountId, userId: user.profile.id } });
    const by = new Map(saved.map((r) => [r.kind, r]));
    return ApiResponse.success(
      {
        rules: ALERT_KINDS.map((kind) => {
          const info = KIND_INFO[kind];
          const r = by.get(kind);
          return {
            kind,
            label: info.label,
            unit: info.unit,
            help: info.help,
            min: info.min,
            max: info.max,
            saved: r !== undefined,
            threshold: r ? r.threshold : info.defaultThreshold,
            enabled: r ? r.enabled : false,
            notifyEmail: r ? r.notifyEmail : true,
            notifyBell: r ? r.notifyBell : true,
            cooldownMin: r ? r.cooldownMin : 60,
            state: r ? r.state : "ok",
            lastFiredAt: r?.lastFiredAt ?? null,
          };
        }),
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
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId : "";
  const v = validateRuleInput(body);
  if (!accountId || !v.ok) return ApiResponse.error({ code: "BAD_REQUEST", message: v.ok ? "accountId is required" : v.message }, ctx.requestId, 400, ctx.startedAt);
  try {
    if (!(await ownedAccount(user.profile.id, accountId))) return ApiResponse.error({ code: "NOT_FOUND", message: "Account not found" }, ctx.requestId, 404, ctx.startedAt);
    const d = v.value;
    await prisma.liveSyncAlertRule.upsert({
      where: { accountId_kind: { accountId, kind: d.kind } },
      create: { userId: user.profile.id, accountId, kind: d.kind, threshold: d.threshold, enabled: d.enabled, notifyEmail: d.notifyEmail, notifyBell: d.notifyBell, cooldownMin: d.cooldownMin },
      // A changed threshold or a re-enable starts clean so the new setting is evaluated fresh.
      update: { threshold: d.threshold, enabled: d.enabled, notifyEmail: d.notifyEmail, notifyBell: d.notifyBell, cooldownMin: d.cooldownMin, state: "ok", lastFiredAt: null },
    });
    return ApiResponse.success({ saved: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});

export const POST = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const body = (await req.json().catch(() => null)) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId : "";
  if (!accountId) return ApiResponse.error({ code: "BAD_REQUEST", message: "accountId is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const acc = await ownedAccount(user.profile.id, accountId);
    if (!acc) return ApiResponse.error({ code: "NOT_FOUND", message: "Account not found" }, ctx.requestId, 404, ctx.startedAt);
    const label = `Account ${acc.accountKey.slice(0, 6)}`;
    const title = `Test alert - ${label}`;
    const text = "This is a test. If you can read this, your Live Sync alerts will reach you. Alerts are information only; AT24 does not trade or close positions for you.";
    await createNotification({ userId: user.profile.id, kind: "live_sync_alert", severity: "info", title, body: text, href: "/dashboard/live-sync" });
    await sendLiveSyncAlertEmail({ to: user.profile.email, recipientUserId: user.profile.id, title, body: text, severity: "warning", dedupeKey: `test:${user.profile.id}:${Date.now()}` });
    // Telegram too, when it is connected (no-op otherwise).
    await sendTelegramToUser(user.profile.id, "alerts", alertMessage({ title, body: text, siteUrl: telegramConfig().siteUrl })).catch(() => false);
    return ApiResponse.success({ sent: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return unavailable(ctx);
  }
});
