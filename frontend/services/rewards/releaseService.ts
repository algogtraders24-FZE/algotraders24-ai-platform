// services/rewards/releaseService.ts
// (Server only.) The daily rewards sweep:
//   1. refunded/reversed purchases cancel their contract (unpaid instalments cancelled, reserve returned, commission reversed);
//   2. due rebate instalments are RELEASED (user eligible), FROZEN (Pro/KYC lapsed - kept, never forfeited) or CANCELLED (revoked);
//   3. referral commissions past their hold are RELEASED;
//   4. contract statuses are refreshed (ACTIVE / FROZEN / ENDED);
//   5. the reserve is reconciled against what is still owed, and any gap is reported.
// Every write is idempotent (unique keys, status-guarded updates) so a retried or overlapping run cannot pay twice.
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decideInstalment, type UserFacts } from "@/lib/rewards/eligibility";
import { contractStatusAfter, purchaseVoided, unreleasedCents, type InstallmentStatus } from "@/lib/rewards/lifecycle";
import { ledgerKey, reserveShortfall, summarizeReserve } from "@/lib/rewards/ledger";
import { loadUserFacts } from "@/lib/rewards/access";

export interface SweepReport {
  ranAt: string;
  contractsCancelled: number;
  released: number;
  frozen: number;
  cancelled: number;
  commissionsReleased: number;
  commissionsReversed: number;
  statusChanges: number;
  reserveOutstandingCents: number;
  owedCents: number;
  shortfallCents: number;
  errors: string[];
}

const BATCH = 200;
const isDuplicate = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Cancels a contract: unpaid instalments cancelled, their cents returned out of the reserve, pending commission reversed, licence left to the caller. */
export async function cancelContract(contractId: string, reason: string, actor: string): Promise<{ ok: boolean; returnedCents: number }> {
  return prisma.$transaction(async (tx) => {
    const contract = await tx.rewardContract.findUnique({ where: { id: contractId } });
    if (!contract || contract.status === "REVOKED") return { ok: false, returnedCents: 0 };
    const open = await tx.rebateInstallment.findMany({ where: { contractId, status: { in: ["SCHEDULED", "FROZEN"] } } });
    const returnedCents = unreleasedCents(open);
    if (open.length) await tx.rebateInstallment.updateMany({ where: { id: { in: open.map((i) => i.id) } }, data: { status: "CANCELLED" } });
    if (returnedCents > 0) {
      await tx.rewardReserveEntry
        .create({ data: { contractId, type: "RETURNED", amountCents: returnedCents, idempotencyKey: `reserve-return:${contractId}` } })
        .catch((e) => { if (!isDuplicate(e)) throw e; });
    }
    await tx.referralCommission.updateMany({ where: { purchaseId: contract.purchaseId, status: "PENDING" }, data: { status: "REVERSED" } });
    await tx.rewardContract.update({ where: { id: contractId }, data: { status: "REVOKED" } });
    await tx.rewardAuditEvent.create({ data: { actor, action: "contract.cancelled", subjectType: "RewardContract", subjectId: contractId, data: { reason, returnedCents } } });
    return { ok: true, returnedCents };
  });
}

export async function runRewardsSweep(now: Date = new Date()): Promise<SweepReport> {
  const report: SweepReport = {
    ranAt: now.toISOString(), contractsCancelled: 0, released: 0, frozen: 0, cancelled: 0, commissionsReleased: 0, commissionsReversed: 0,
    statusChanges: 0, reserveOutstandingCents: 0, owedCents: 0, shortfallCents: 0, errors: [],
  };
  const factsCache = new Map<string, UserFacts>();
  const factsFor = async (userId: string): Promise<UserFacts> => {
    const hit = factsCache.get(userId);
    if (hit) return hit;
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const f = await loadUserFacts(userId, u?.email);
    factsCache.set(userId, f);
    return f;
  };

  // 1. Refunded / reversed purchases cancel their contract.
  const live = await prisma.rewardContract.findMany({ where: { status: { in: ["ACTIVE", "FROZEN", "PENDING_DOCUMENT"] } }, select: { id: true, purchaseId: true }, take: 1000 });
  if (live.length) {
    const voided = await prisma.purchase.findMany({ where: { id: { in: live.map((c) => c.purchaseId) } }, select: { id: true, status: true } });
    const bad = new Set(voided.filter((p) => purchaseVoided(p.status)).map((p) => p.id));
    for (const c of live.filter((x) => bad.has(x.purchaseId))) {
      try {
        const r = await cancelContract(c.id, "purchase refunded or reversed", "system");
        if (r.ok) report.contractsCancelled++;
      } catch (e) {
        report.errors.push(`cancel ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // 2. Due instalments.
  const due = await prisma.rebateInstallment.findMany({
    where: { status: { in: ["SCHEDULED", "FROZEN"] }, dueAt: { lte: now } },
    orderBy: { dueAt: "asc" },
    take: BATCH,
  });
  const contracts = new Map((await prisma.rewardContract.findMany({ where: { id: { in: [...new Set(due.map((d) => d.contractId))] } } })).map((c) => [c.id, c]));
  for (const inst of due) {
    const contract = contracts.get(inst.contractId);
    if (!contract) continue;
    try {
      const decision = decideInstalment({ status: contract.status as never, endsAt: contract.endsAt }, await factsFor(inst.userId), now);
      if (decision.action === "RELEASE") {
        const moved = await prisma.$transaction(async (tx) => {
          const upd = await tx.rebateInstallment.updateMany({ where: { id: inst.id, status: { in: ["SCHEDULED", "FROZEN"] } }, data: { status: "RELEASED", releasedAt: now } });
          if (upd.count === 0) return false; // another run got there first
          await tx.rewardLedgerEntry.create({
            data: { userId: inst.userId, type: "REBATE_RELEASED", amountCents: inst.amountCents, refType: "RebateInstallment", refId: inst.id, idempotencyKey: ledgerKey.release(inst.contractId, inst.seq) },
          });
          await tx.rewardReserveEntry.create({
            data: { contractId: inst.contractId, type: "RELEASED", amountCents: inst.amountCents, idempotencyKey: `reserve-release:${inst.contractId}:${inst.seq}` },
          });
          await tx.rewardAuditEvent.create({ data: { actor: "system", action: "rebate.released", subjectType: "RebateInstallment", subjectId: inst.id, data: { contractId: inst.contractId, seq: inst.seq, amountCents: inst.amountCents } } });
          return true;
        });
        if (moved) report.released++;
      } else if (decision.action === "FREEZE") {
        if (inst.status === "SCHEDULED") {
          const upd = await prisma.rebateInstallment.updateMany({ where: { id: inst.id, status: "SCHEDULED" }, data: { status: "FROZEN" } });
          if (upd.count) {
            report.frozen++;
            await prisma.rewardAuditEvent.create({ data: { actor: "system", action: "rebate.frozen", subjectType: "RebateInstallment", subjectId: inst.id, data: { reason: decision.reason } } });
          }
        }
      } else {
        const upd = await prisma.rebateInstallment.updateMany({ where: { id: inst.id, status: { in: ["SCHEDULED", "FROZEN"] } }, data: { status: "CANCELLED" } });
        if (upd.count) report.cancelled++;
      }
    } catch (e) {
      if (isDuplicate(e)) continue; // the ledger key already exists: this instalment was released by an earlier run
      report.errors.push(`instalment ${inst.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2b. A commission released at once (no hold) whose purchase is refunded or reversed before the partner asked for it is taken back.
  const liveComm = await prisma.referralCommission.findMany({ where: { status: "RELEASED", payoutId: null, NOT: { purchaseId: { startsWith: "sub:" } } }, select: { id: true, purchaseId: true, partnerId: true, amountCents: true }, take: BATCH });
  if (liveComm.length) {
    const st = new Map((await prisma.purchase.findMany({ where: { id: { in: [...new Set(liveComm.map((c) => c.purchaseId))] } }, select: { id: true, status: true } })).map((p) => [p.id, p.status]));
    for (const c of liveComm.filter((x) => purchaseVoided(st.get(x.purchaseId) ?? "COMPLETED"))) {
      try {
        const upd = await prisma.referralCommission.updateMany({ where: { id: c.id, status: "RELEASED", payoutId: null }, data: { status: "REVERSED" } });
        if (upd.count) report.commissionsReversed++;
      } catch (e) {
        report.errors.push(`commission reverse ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // 3. Referral commissions past the hold.
  const pending = await prisma.referralCommission.findMany({ where: { status: "PENDING", availableAt: { lte: now } }, take: BATCH });
  if (pending.length) {
    const purchases = new Map((await prisma.purchase.findMany({ where: { id: { in: [...new Set(pending.map((c) => c.purchaseId))] } }, select: { id: true, status: true } })).map((p) => [p.id, p.status]));
    for (const c of pending) {
      try {
        // A "sub:<paymentId>" reference (a Pro subscription payment) has no purchase row; it is only created on a confirmed payment, so it is never voided here.
        const voided = c.purchaseId.startsWith("sub:") ? false : purchaseVoided(purchases.get(c.purchaseId) ?? "REVERSED");
        const upd = await prisma.referralCommission.updateMany({
          where: { id: c.id, status: "PENDING" },
          // availableAt already includes the hold period, so the released commission is withdrawable straight away.
          data: voided ? { status: "REVERSED" } : { status: "RELEASED", releasedAt: c.availableAt },
        });
        if (upd.count) {
          if (voided) report.commissionsReversed++;
          else {
            report.commissionsReleased++;
            await prisma.rewardLedgerEntry
              .create({ data: { userId: c.partnerId, type: "COMMISSION_RELEASED", amountCents: c.amountCents, refType: "ReferralCommission", refId: c.id, idempotencyKey: ledgerKey.commission(c.purchaseId, c.level) } })
              .catch((e) => { if (!isDuplicate(e)) throw e; });
          }
        }
      } catch (e) {
        report.errors.push(`commission ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // 4. Contract statuses.
  const toRefresh = await prisma.rewardContract.findMany({ where: { status: { in: ["ACTIVE", "FROZEN"] } }, take: 1000 });
  if (toRefresh.length) {
    const insts = await prisma.rebateInstallment.findMany({ where: { contractId: { in: toRefresh.map((c) => c.id) } }, select: { contractId: true, status: true } });
    for (const c of toRefresh) {
      const next = contractStatusAfter(c.status as never, insts.filter((i) => i.contractId === c.id).map((i) => i.status as InstallmentStatus), c.endsAt, now);
      if (next !== c.status) {
        await prisma.rewardContract.updateMany({ where: { id: c.id, status: c.status }, data: { status: next } });
        report.statusChanges++;
      }
    }
  }

  // 5. Reserve vs what is still owed (instalments not yet released or cancelled). They must match; a gap is reported loudly.
  const [reserveRows, owed] = await Promise.all([
    prisma.rewardReserveEntry.findMany({ select: { type: true, amountCents: true } }),
    prisma.rebateInstallment.aggregate({ where: { status: { in: ["SCHEDULED", "FROZEN"] } }, _sum: { amountCents: true } }),
  ]);
  const reserve = summarizeReserve(reserveRows.map((r) => ({ type: r.type as "RESERVED" | "RELEASED" | "RETURNED", amountCents: r.amountCents })));
  report.reserveOutstandingCents = reserve.outstanding;
  report.owedCents = owed._sum.amountCents ?? 0;
  report.shortfallCents = reserveShortfall(report.owedCents, reserve.outstanding);
  if (report.shortfallCents > 0 || reserve.outstanding !== report.owedCents) {
    report.errors.push(`reserve mismatch: reserve outstanding ${reserve.outstanding} cents vs owed ${report.owedCents} cents`);
    console.error("[rewards] RESERVE MISMATCH", { reserveOutstanding: reserve.outstanding, owed: report.owedCents });
  }
  return report;
}
