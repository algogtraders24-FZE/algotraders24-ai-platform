// services/billing/RenewalReminderService.ts
// B05 (AT24_EMAIL_COMMUNICATION_RECONCILIATION.md Section 18) - "N days
// before currentPeriodEnd" had no job reading it for a reminder purpose.
// Meant to run once daily (Vercel Hobby = one cron/day, see
// app/api/private/billing/cron/renewal-reminders/route.ts) - the target
// window is a 24h bucket exactly REMINDER_WINDOW_DAYS out, so each real
// subscription renewal falls into exactly one day's run.
//
// Only real, provider-backed subscriptions (provider set by a verified
// Stripe/NOWPayments webhook - see Subscription.provider's own schema
// comment) are reminded; a free/admin-granted plan has no real charge
// coming and would be a false "your plan renews soon."
import "server-only";
import { prisma } from "@/lib/prisma";
import { sendRenewalReminderEmail } from "@/services/notifications/EmailService";
import { wasEmailAlreadySent } from "@/services/notifications/EmailLogService";

export const REMINDER_WINDOW_DAYS = 3;

function dedupeKeyFor(subscriptionId: string, periodEnd: Date): string {
  return `${subscriptionId}:${periodEnd.toISOString()}`;
}

export interface RenewalReminderReport {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
}

export async function dispatchRenewalReminders(windowDays: number = REMINDER_WINDOW_DAYS): Promise<RenewalReminderReport> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

  const dueSubscriptions = await prisma.subscription.findMany({
    where: {
      status: "active",
      cancelAtPeriodEnd: false,
      deletedAt: null,
      provider: { not: null },
      currentPeriodEnd: { gte: windowStart, lt: windowEnd },
    },
  });

  const report: RenewalReminderReport = { checked: dueSubscriptions.length, sent: 0, skipped: 0, failed: 0 };

  for (const sub of dueSubscriptions) {
    const dedupeKey = dedupeKeyFor(sub.id, sub.currentPeriodEnd);
    try {
      if (await wasEmailAlreadySent("renewal_reminder", dedupeKey)) {
        report.skipped++;
        continue;
      }

      const [buyer, plan] = await Promise.all([
        prisma.user.findUnique({ where: { id: sub.userId }, select: { email: true, name: true } }),
        prisma.plan.findUnique({ where: { id: sub.planId }, select: { name: true, price: true } }),
      ]);
      if (!buyer || !plan) {
        report.skipped++;
        continue;
      }

      await sendRenewalReminderEmail({
        to: buyer.email,
        buyerName: buyer.name || "there",
        planName: plan.name,
        amount: plan.price,
        currency: "USD", // matches the existing subscription-active/payment-failed emails - Plan has no currency field, product is USD-only today
        periodEnd: sub.currentPeriodEnd,
        dedupeKey,
      });
      report.sent++;
    } catch (err) {
      report.failed++;
      console.error(`[renewal-reminder] failed for subscription ${sub.id} (non-fatal, continuing sweep)`, err);
    }
  }

  return report;
}
