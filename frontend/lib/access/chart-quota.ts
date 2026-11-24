// lib/access/chart-quota.ts
// Who may run Analyze / ask PRAGYA on the Pro Chart, and how often. Pure rules (no database), unit-tested by scripts/validate-chart-quota.ts.
// Owner decision 2026-11-24: a free user gets 30 days free (counted from the first use) with 10 analyses a day; after that Analyze and PRAGYA need a paid plan.
// Paid users have a higher daily cap, admins are not limited. The day is the UTC day.

export const CHART_QUOTA = {
  freeTrialDays: 30,
  /** Analyze runs per day. */
  freeAnalyzeDaily: 10,
  proAnalyzeDaily: 60,
  /** PRAGYA answers per day (each Analyze asks PRAGYA once, plus chat and voice questions). */
  freePragyaDaily: 20,
  proPragyaDaily: 120,
} as const;

export type QuotaKind = "chart_analyze" | "pragya_answer";
export type QuotaReason = "ok" | "daily_limit" | "trial_ended";

export interface QuotaInput {
  kind: QuotaKind;
  now: Date;
  /** When this user first used Analyze or PRAGYA (null = never): the free period starts there. */
  firstUseAt: Date | null;
  usedToday: number;
  isPro: boolean;
  isAdmin: boolean;
}

export interface QuotaDecision {
  allowed: boolean;
  reason: QuotaReason;
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
  isPro: boolean;
  /** Whole days of the free period left (free users only; null for paid users and admins). */
  trialDaysLeft: number | null;
  trialEndsAt: string | null;
}

const DAY_MS = 86_400_000;

export const utcDayStart = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export function dailyLimitFor(kind: QuotaKind, isPro: boolean): number {
  if (kind === "chart_analyze") return isPro ? CHART_QUOTA.proAnalyzeDaily : CHART_QUOTA.freeAnalyzeDaily;
  return isPro ? CHART_QUOTA.proPragyaDaily : CHART_QUOTA.freePragyaDaily;
}

export function decideQuota(i: QuotaInput): QuotaDecision {
  const dailyLimit = dailyLimitFor(i.kind, i.isPro || i.isAdmin);
  const used = Math.max(0, i.usedToday);
  if (i.isAdmin) return { allowed: true, reason: "ok", dailyLimit, usedToday: used, remainingToday: Math.max(0, dailyLimit - used), isPro: true, trialDaysLeft: null, trialEndsAt: null };
  if (i.isPro) {
    const allowed = used < dailyLimit;
    return { allowed, reason: allowed ? "ok" : "daily_limit", dailyLimit, usedToday: used, remainingToday: Math.max(0, dailyLimit - used), isPro: true, trialDaysLeft: null, trialEndsAt: null };
  }
  const start = i.firstUseAt ?? i.now;
  const endsMs = start.getTime() + CHART_QUOTA.freeTrialDays * DAY_MS;
  const trialDaysLeft = Math.max(0, Math.ceil((endsMs - i.now.getTime()) / DAY_MS));
  const trialEndsAt = new Date(endsMs).toISOString();
  if (i.now.getTime() >= endsMs) return { allowed: false, reason: "trial_ended", dailyLimit, usedToday: used, remainingToday: 0, isPro: false, trialDaysLeft: 0, trialEndsAt };
  const allowed = used < dailyLimit;
  return { allowed, reason: allowed ? "ok" : "daily_limit", dailyLimit, usedToday: used, remainingToday: Math.max(0, dailyLimit - used), isPro: false, trialDaysLeft, trialEndsAt };
}
