// services/rewards/kycReminder.ts
// (Server only.) Finds members who hold an active PAID plan (a real payment behind it) but have no verified identity, and sends them the
// KYC reminder email. Admin-triggered only (never automatic), a dry run by default, capped per run, and sent at most once per person.
import { prisma } from "@/lib/prisma";
import { sendKycReminderEmail } from "@/services/notifications/EmailService";

export interface KycTarget { userId: string; email: string; name: string }

export async function findKycReminderTargets(limit: number, now: Date = new Date()): Promise<KycTarget[]> {
  const subs = await prisma.subscription.findMany({
    where: { deletedAt: null, status: "active", provider: { not: null }, planId: { not: "free" }, currentPeriodEnd: { gt: now } },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (subs.length === 0) return [];
  const ids = subs.map((s) => s.userId);
  const verified = new Set((await prisma.sellerIdentity.findMany({ where: { userId: { in: ids }, status: "VERIFIED" }, select: { userId: true } })).map((r) => r.userId));
  const users = await prisma.user.findMany({
    where: { id: { in: ids.filter((id) => !verified.has(id)) }, status: "active", deletedAt: null },
    select: { id: true, email: true, name: true },
    take: limit,
  });
  return users.map((u) => ({ userId: u.id, email: u.email, name: u.name || "there" }));
}

export async function runKycReminders(opts: { send: boolean; limit: number }): Promise<{ matched: number; sent: number; sample: string[] }> {
  const targets = await findKycReminderTargets(opts.limit);
  let sent = 0;
  if (opts.send) {
    for (const t of targets) {
      try {
        await sendKycReminderEmail({ to: t.email, name: t.name, userId: t.userId });
        sent++;
      } catch (e) {
        console.error("[rewards] KYC reminder failed for one recipient:", e instanceof Error ? e.message : e);
      }
    }
  }
  // Only masked addresses are returned, so the response itself does not leak a mailing list.
  return { matched: targets.length, sent, sample: targets.slice(0, 5).map((t) => t.email.replace(/^(.).*(@.*)$/, "$1***$2")) };
}
