// services/live-sync/alert-runner.ts
// DB side of Live Sync alerts: load the rules and recent numbers for one account, run the pure evaluator,
// persist the state change and notify (bell + email). Called after each stored snapshot (see the ingest route)
// and by the offline sweep. Never throws to its caller and never blocks ingestion.

import { prisma } from "@/lib/prisma";
import { createNotification } from "@/services/notifications/NotificationService";
import { sendLiveSyncAlertEmail } from "@/services/notifications/EmailService";
import { sendTelegramToUser } from "@/services/telegram/deliver";
import { alertMessage } from "@/services/telegram/messages";
import { telegramConfig } from "@/services/telegram/config";
import type { WirePosition } from "./contract";
import { alertSeverity, alertText, evaluateRule, nextTransition, type AlertContext, type AlertKind } from "./alerts";

const DAY = 86_400_000;
const PEAK_WINDOW_MS = 30 * DAY;

export async function runAlertsForAccount(accountId: string, nowDate: Date = new Date()): Promise<number> {
  try {
    const rules = await prisma.liveSyncAlertRule.findMany({ where: { accountId } });
    if (rules.length === 0) return 0;
    const account = await prisma.liveSyncAccount.findUnique({ where: { id: accountId }, select: { userId: true, accountKey: true, serverUtcOffsetSec: true, lastSyncAt: true } });
    if (!account) return 0;
    const now = nowDate.getTime();

    const latest = await prisma.liveSyncSnapshot.findFirst({ where: { accountId }, orderBy: { timeUtc: "desc" }, select: { balance: true, equity: true, margin: true, positions: true } });
    const dayStartUtc = Math.floor((now + account.serverUtcOffsetSec * 1000) / DAY) * DAY - account.serverUtcOffsetSec * 1000;
    const dayFirst = await prisma.liveSyncSnapshot.findFirst({ where: { accountId, timeUtc: { gte: new Date(dayStartUtc) } }, orderBy: { timeUtc: "asc" }, select: { balance: true } });
    const peak = await prisma.liveSyncSnapshot.aggregate({ where: { accountId, timeUtc: { gte: new Date(now - PEAK_WINDOW_MS) } }, _max: { equity: true } });

    const ctx: AlertContext = {
      nowUtc: now,
      serverUtcOffsetSec: account.serverUtcOffsetSec,
      lastSyncAt: account.lastSyncAt.getTime(),
      snapshot: latest ? { balance: latest.balance, equity: latest.equity, margin: latest.margin, positions: (Array.isArray(latest.positions) ? latest.positions : []) as unknown as WirePosition[] } : null,
      dayStartBalance: dayFirst ? dayFirst.balance : null,
      peakEquity: peak._max.equity ?? null,
    };

    const label = `Account ${account.accountKey.slice(0, 6)}`;
    let user: { email: string } | null | undefined;
    let fired = 0;

    for (const rule of rules) {
      const kind = rule.kind as AlertKind;
      const ev = evaluateRule({ kind, threshold: rule.threshold }, ctx);
      const tr = nextTransition({ state: rule.state === "firing" ? "firing" : "ok", lastFiredAt: rule.lastFiredAt ? rule.lastFiredAt.getTime() : null, cooldownMin: rule.cooldownMin, enabled: rule.enabled }, ev, now);
      if (tr.action === "none") continue;

      // Compare-and-set so two concurrent runs cannot announce the same breach twice.
      const cas = await prisma.liveSyncAlertRule.updateMany({
        where: { id: rule.id, state: rule.state, lastFiredAt: rule.lastFiredAt },
        data: tr.action === "fire" ? { state: "firing", lastFiredAt: nowDate, lastValue: ev.value } : { state: "ok", lastValue: ev.value },
      });
      if (cas.count === 0 || tr.action === "resolve") continue;

      fired++;
      const text = alertText(kind, ev, label, tr.reminder);
      const severity = alertSeverity(kind, ev.value);
      if (rule.notifyBell) {
        await createNotification({ userId: account.userId, kind: "live_sync_alert", severity, title: text.title, body: text.body, href: "/dashboard/live-sync" }).catch(() => undefined);
      }
      if (rule.notifyEmail) {
        user ??= await prisma.user.findUnique({ where: { id: account.userId }, select: { email: true } });
        if (user) await sendLiveSyncAlertEmail({ to: user.email, recipientUserId: account.userId, title: text.title, body: text.body, severity, dedupeKey: `${rule.id}:${Math.floor(now / (rule.cooldownMin * 60_000))}` }).catch(() => undefined);
      }
      // Telegram: only when the user linked it (a no-op otherwise); best effort, never blocks the alert.
      await sendTelegramToUser(account.userId, "alerts", alertMessage({ title: text.title, body: text.body, siteUrl: telegramConfig().siteUrl })).catch(() => false);
    }
    return fired;
  } catch {
    return 0;
  }
}

/** For the timer/pinger: accounts that have gone quiet while an offline rule is on. */
export async function sweepOfflineAlerts(nowDate: Date = new Date()): Promise<{ checked: number; fired: number }> {
  try {
    const now = nowDate.getTime();
    const rules = await prisma.liveSyncAlertRule.findMany({ where: { kind: "ea_offline" }, select: { accountId: true, threshold: true, enabled: true, state: true }, take: 500 });
    if (rules.length === 0) return { checked: 0, fired: 0 };
    const accounts = await prisma.liveSyncAccount.findMany({ where: { id: { in: rules.map((r) => r.accountId) } }, select: { id: true, lastSyncAt: true } });
    const last = new Map(accounts.map((a) => [a.id, a.lastSyncAt.getTime()]));
    let checked = 0, fired = 0;
    for (const r of rules) {
      const l = last.get(r.accountId);
      if (l === undefined) continue;
      const quiet = now - l >= r.threshold * 60_000;
      if (!quiet && r.state !== "firing") continue; // nothing to announce and nothing to reset
      checked++;
      fired += await runAlertsForAccount(r.accountId, nowDate);
    }
    return { checked, fired };
  } catch {
    return { checked: 0, fired: 0 };
  }
}
