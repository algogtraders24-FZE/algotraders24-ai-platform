// services/chart/chart-quota.service.ts
// The database side of the Analyze / PRAGYA limits (rules: lib/access/chart-quota.ts). Uses the existing RequestLog table (no schema change):
// one row per Analyze run ("chart_analyze") and per PRAGYA answer ("pragya_answer"). The free period starts at the user's first row of either kind.
import { prisma } from "@/lib/prisma";
import { hasQuantProAccess } from "@/lib/access/quant-pro";
import { decideBacktest, decideQuota, utcDayStart, type BacktestDecision, type QuotaDecision, type QuotaKind } from "@/lib/access/chart-quota";

const KINDS: QuotaKind[] = ["chart_analyze", "pragya_answer"];

async function load(userId: string, role: string | undefined, kind: QuotaKind, now: Date): Promise<QuotaDecision> {
  const isAdmin = role === "admin";
  const [first, usedToday, isPro] = await Promise.all([
    prisma.requestLog.findFirst({ where: { userId, type: { in: KINDS } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.requestLog.count({ where: { userId, type: kind, createdAt: { gte: utcDayStart(now) } } }),
    isAdmin ? Promise.resolve(true) : hasQuantProAccess(userId),
  ]);
  return decideQuota({ kind, now, firstUseAt: first?.createdAt ?? null, usedToday, isPro: isPro && !isAdmin, isAdmin });
}

export const chartQuotaService = {
  /** Where the user stands, without using anything up. */
  status: (userId: string, role: string | undefined, kind: QuotaKind, now = new Date()) => load(userId, role, kind, now),

  /** Uses one run when the user is within the limits. The returned decision is the state BEFORE this run (allowed = it was counted). */
  async consume(userId: string, role: string | undefined, kind: QuotaKind, now = new Date()): Promise<QuotaDecision> {
    const d = await load(userId, role, kind, now);
    if (!d.allowed) return d;
    await prisma.requestLog.create({ data: { userId, type: kind } });
    return { ...d, usedToday: d.usedToday + 1, remainingToday: Math.max(0, d.remainingToday - 1) };
  },
};

/** Strategy Tester backtests (registry strategies): one free test, then a paid plan. One RequestLog row ("algo_test_run") per COMPLETED run. */
export const backtestQuotaService = {
  async status(userId: string, role: string | undefined, now = new Date()): Promise<BacktestDecision> {
    const isAdmin = role === "admin";
    const [usedTotal, usedToday, isPro] = await Promise.all([
      prisma.requestLog.count({ where: { userId, type: "algo_test_run" } }),
      prisma.requestLog.count({ where: { userId, type: "algo_test_run", createdAt: { gte: utcDayStart(now) } } }),
      isAdmin ? Promise.resolve(true) : hasQuantProAccess(userId),
    ]);
    return decideBacktest({ usedTotal, usedToday, isPro: isPro && !isAdmin, isAdmin });
  },
  async recordCompleted(userId: string): Promise<void> {
    await prisma.requestLog.create({ data: { userId, type: "algo_test_run" } });
  },
};
