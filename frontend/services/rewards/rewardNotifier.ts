// services/rewards/rewardNotifier.ts
// (Server only.) Tells members (bell + email) and ops (email) what happened in the wallet. EVERYTHING here is best effort: it never throws and
// never blocks or undoes the money movement it describes. Each email is deduped on the event (EmailLog), so a replay sends nothing twice.
// Referral commission: a bell notice every time, an email only for a partner's FIRST commission (small ones would flood the inbox).
import { prisma } from "@/lib/prisma";
import { REWARD_PRODUCTS, isRewardProductKey } from "@/lib/rewards/config";
import { maskAddress } from "@/lib/rewards/payoutAddress";
import { formatUsd } from "@/lib/rewards/money";
import * as N from "@/lib/rewards/notices";
import { levelLabel, sourceLabel, maskName, type CommissionSource } from "@/lib/rewards/wallet";
import { createNotification } from "@/services/notifications/NotificationService";
import { sendRewardsNoticeEmail, sendWithdrawalRequestAlert } from "@/services/notifications/EmailService";

async function send(userId: string, notice: N.Notice, dedupeKey: string, opts: { email?: boolean } = {}): Promise<void> {
  try {
    await createNotification({ userId, kind: `rewards.${notice.kind}`, severity: notice.severity, title: notice.title, body: notice.text, href: notice.href });
  } catch (e) {
    console.error("[rewards] bell notice failed (non-fatal):", e);
  }
  if (opts.email === false) return;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user?.email) {
      await sendRewardsNoticeEmail({ to: user.email, recipientUserId: userId, kind: notice.kind, dedupeKey, title: notice.title, text: notice.text, rows: notice.rows, href: notice.href, cta: notice.cta });
    }
  } catch (e) {
    console.error("[rewards] email notice failed (non-fatal):", e);
  }
}

const contractName = (key: string) => (isRewardProductKey(key) ? REWARD_PRODUCTS[key].name : "Algo Contract");

export async function notifyWithdrawalRequested(p: { payoutId: string; userId: string; userEmail: string; amountCents: number; network: string; address: string }): Promise<void> {
  const masked = maskAddress(p.address);
  await send(p.userId, N.withdrawalRequested({ amountCents: p.amountCents, network: p.network, maskedAddress: masked }), p.payoutId);
  try {
    await sendWithdrawalRequestAlert({ payoutId: p.payoutId, userEmail: p.userEmail, amountText: formatUsd(p.amountCents), network: p.network, maskedAddress: masked });
  } catch (e) {
    console.error("[rewards] ops withdrawal alert failed (non-fatal):", e);
  }
}

export async function notifyWithdrawalDecided(p: { payoutId: string; userId: string; amountCents: number; network: string; decision: "PAID" | "REJECTED"; txRef?: string | null; note?: string | null }): Promise<void> {
  const notice = p.decision === "PAID"
    ? N.withdrawalPaid({ amountCents: p.amountCents, network: p.network, txRef: p.txRef ?? "" })
    : N.withdrawalDeclined({ amountCents: p.amountCents, note: p.note });
  await send(p.userId, notice, `${p.payoutId}:${p.decision}`);
}

export async function notifyInstalment(p: { instalmentId: string; userId: string; contractId: string; seq: number; amountCents: number; paused: boolean }): Promise<void> {
  try {
    const [contract, total] = await Promise.all([
      prisma.rewardContract.findUnique({ where: { id: p.contractId }, select: { productKey: true } }),
      prisma.rebateInstallment.count({ where: { contractId: p.contractId } }),
    ]);
    const input = { amountCents: p.amountCents, contractName: contractName(contract?.productKey ?? ""), seq: p.seq, total };
    await send(p.userId, p.paused ? N.instalmentPaused(input) : N.instalmentReleased(input), `${p.instalmentId}:${p.paused ? "paused" : "released"}`);
  } catch (e) {
    console.error("[rewards] instalment notice failed (non-fatal):", e);
  }
}

export async function notifyContractCancelled(p: { contractId: string; userId: string; productKey: string; reason: string }): Promise<void> {
  await send(p.userId, N.contractCancelled({ contractName: contractName(p.productKey), reason: p.reason }), p.contractId);
}

export async function notifyCommission(p: { commissionId: string; partnerId: string; level: number; amountCents: number; source: CommissionSource; detail?: string | null; buyerId?: string | null }): Promise<void> {
  try {
    let buyerName: string | null = null;
    if (p.buyerId) {
      const b = await prisma.user.findUnique({ where: { id: p.buyerId }, select: { name: true, email: true } });
      buyerName = b ? maskName(b.name, b.email) : null;
    }
    const first = (await prisma.referralCommission.count({ where: { partnerId: p.partnerId } })) <= 1;
    await send(p.partnerId, N.commissionCredited({ amountCents: p.amountCents, levelLabel: levelLabel(p.level), sourceText: sourceLabel(p.source, p.detail), buyerName }), p.commissionId, { email: first });
  } catch (e) {
    console.error("[rewards] commission notice failed (non-fatal):", e);
  }
}
