// services/rewards/payoutStore.ts
// (Server only.) A member's balance and USDT withdrawals for the Algo Contracts program. Mirrors the seller payout pattern but with
// its own tables so program money and marketplace seller money never mix. A request takes the WHOLE available balance (rebate
// instalments and referral commission that are released and past the hold); an admin pays it by hand. Eligibility (active paid Pro,
// verified identity, withdrawals switched on) is checked at the request AND again when the admin approves.
import { prisma } from "@/lib/prisma";
import { HOLD_DAYS, MIN_PAYOUT_CENTS, withdrawalsEnabled } from "@/lib/rewards/config";
import { canWithdraw } from "@/lib/rewards/eligibility";
import { summarizeBalances, type Balances, type BalanceItem } from "@/lib/rewards/ledger";
import { addDays } from "@/lib/rewards/money";
import { loadUserFacts } from "@/lib/rewards/access";
import { validatePayoutAddress } from "@/lib/marketplace/earnings";

export async function getBalances(userId: string, now: Date = new Date()): Promise<Balances> {
  const [inst, comm] = await Promise.all([
    prisma.rebateInstallment.findMany({ where: { userId }, select: { amountCents: true, status: true, releasedAt: true, payoutId: true } }),
    prisma.referralCommission.findMany({ where: { partnerId: userId }, select: { amountCents: true, status: true, releasedAt: true, payoutId: true } }),
  ]);
  const items: BalanceItem[] = [...inst, ...comm.filter((c) => c.status !== "PENDING")];
  const b = summarizeBalances(items, now);
  // A commission still inside its hold has not been released by the sweep yet: it counts as holding, not as owed-later.
  b.holding += comm.filter((c) => c.status === "PENDING").reduce((s, c) => s + c.amountCents, 0);
  return b;
}

export async function listPayouts(userId: string) {
  return prisma.rewardPayout.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 });
}

export type RequestResult = { ok: true; payoutId: string; amountCents: number } | { ok: false; code: string; message: string };

export async function requestWithdrawal(input: { userId: string; email: string; network: string; address: string; now?: Date }): Promise<RequestResult> {
  const now = input.now ?? new Date();
  const addrProblem = validatePayoutAddress(input.network, input.address);
  if (addrProblem) return { ok: false, code: "BAD_ADDRESS", message: addrProblem };

  const open = await prisma.rewardPayout.findFirst({ where: { userId: input.userId, status: "REQUESTED" }, select: { id: true } });
  if (open) return { ok: false, code: "OPEN_REQUEST", message: "You already have a withdrawal waiting to be paid." };

  const holdCutoff = addDays(now, -HOLD_DAYS);
  const [inst, comm] = await Promise.all([
    prisma.rebateInstallment.findMany({ where: { userId: input.userId, status: "RELEASED", payoutId: null, releasedAt: { lte: holdCutoff } }, select: { id: true, amountCents: true } }),
    prisma.referralCommission.findMany({ where: { partnerId: input.userId, status: "RELEASED", payoutId: null, releasedAt: { lte: now } }, select: { id: true, amountCents: true } }),
  ]);
  const total = [...inst, ...comm].reduce((s, i) => s + i.amountCents, 0);
  const facts = await loadUserFacts(input.userId, input.email);
  const verdict = canWithdraw(facts, { availableCents: total, amountCents: total, minCents: MIN_PAYOUT_CENTS, withdrawalsOn: withdrawalsEnabled(), now });
  if (!verdict.ok) return { ok: false, code: "NOT_ELIGIBLE", message: verdict.reasons[0] };

  try {
    const payoutId = await prisma.$transaction(async (tx) => {
      const payout = await tx.rewardPayout.create({ data: { userId: input.userId, amountCents: total, network: input.network, address: input.address.trim(), status: "REQUESTED" } });
      // Take exactly the items we summed. If another request grabbed any of them in the meantime the counts differ and we stop.
      const a = await tx.rebateInstallment.updateMany({ where: { id: { in: inst.map((i) => i.id) }, payoutId: null, status: "RELEASED" }, data: { payoutId: payout.id } });
      const b = await tx.referralCommission.updateMany({ where: { id: { in: comm.map((c) => c.id) }, payoutId: null, status: "RELEASED" }, data: { payoutId: payout.id } });
      if (a.count !== inst.length || b.count !== comm.length) throw new Error("BALANCE_CHANGED");
      await tx.rewardAuditEvent.create({ data: { actor: input.userId, action: "payout.requested", subjectType: "RewardPayout", subjectId: payout.id, data: { amountCents: total, network: input.network } } });
      return payout.id;
    });
    return { ok: true, payoutId, amountCents: total };
  } catch (e) {
    if (e instanceof Error && e.message === "BALANCE_CHANGED") return { ok: false, code: "BALANCE_CHANGED", message: "Your balance changed while we were processing. Please try again." };
    throw e;
  }
}

export type DecideResult = { ok: true } | { ok: false; code: string; message: string };

/** Admin: mark a request PAID (needs the transaction reference, and the member must still be eligible) or REJECTED (items go back to the balance). */
export async function decideWithdrawal(input: { payoutId: string; decision: "PAID" | "REJECTED"; txRef?: string; note?: string; adminId: string; now?: Date }): Promise<DecideResult> {
  const now = input.now ?? new Date();
  const payout = await prisma.rewardPayout.findUnique({ where: { id: input.payoutId } });
  if (!payout || payout.status !== "REQUESTED") return { ok: false, code: "NOT_FOUND", message: "No open request with that id." };

  if (input.decision === "PAID") {
    const txRef = (input.txRef ?? "").trim();
    if (txRef.length < 6) return { ok: false, code: "TX_REQUIRED", message: "Enter the transaction reference of the USDT transfer." };
    const user = await prisma.user.findUnique({ where: { id: payout.userId }, select: { email: true } });
    const facts = await loadUserFacts(payout.userId, user?.email);
    const verdict = canWithdraw(facts, { availableCents: payout.amountCents, amountCents: payout.amountCents, minCents: MIN_PAYOUT_CENTS, withdrawalsOn: withdrawalsEnabled(), now });
    if (!verdict.ok) return { ok: false, code: "NOT_ELIGIBLE", message: `Cannot pay now: ${verdict.reasons[0]} Reject the request to return the amount to the member's balance.` };
    await prisma.$transaction([
      prisma.rebateInstallment.updateMany({ where: { payoutId: payout.id }, data: { status: "PAID" } }),
      prisma.referralCommission.updateMany({ where: { payoutId: payout.id }, data: { status: "PAID" } }),
      prisma.rewardPayout.update({ where: { id: payout.id }, data: { status: "PAID", txRef, note: input.note?.slice(0, 300) ?? null, decidedAt: now } }),
      prisma.rewardLedgerEntry.create({ data: { userId: payout.userId, type: "PAYOUT_PAID", amountCents: -payout.amountCents, refType: "RewardPayout", refId: payout.id, idempotencyKey: `payout:${payout.id}` } }),
      prisma.rewardAuditEvent.create({ data: { actor: input.adminId, action: "payout.paid", subjectType: "RewardPayout", subjectId: payout.id, data: { amountCents: payout.amountCents, txRef } } }),
    ]);
    return { ok: true };
  }

  await prisma.$transaction([
    prisma.rebateInstallment.updateMany({ where: { payoutId: payout.id }, data: { payoutId: null } }),
    prisma.referralCommission.updateMany({ where: { payoutId: payout.id }, data: { payoutId: null } }),
    prisma.rewardPayout.update({ where: { id: payout.id }, data: { status: "REJECTED", note: input.note?.slice(0, 300) ?? null, decidedAt: now } }),
    prisma.rewardAuditEvent.create({ data: { actor: input.adminId, action: "payout.rejected", subjectType: "RewardPayout", subjectId: payout.id, data: { note: input.note ?? null } } }),
  ]);
  return { ok: true };
}
