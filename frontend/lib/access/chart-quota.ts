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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Strategy Tester backtests of registry strategies (owner decision 2026-11-25: a free user gets ONE free test, then a paid plan is needed).
// The free test is limited to a window of 90 days to bound its cost; paid users have a daily cap; admins are not limited.

export const BACKTEST_QUOTA = {
  /** Completed backtests a free user may run in total. */
  freeTotal: 1,
  /** Longest window (days) of that free test. */
  freeMaxRangeDays: 90,
  /** Completed backtests a paid user may run per UTC day. */
  proDaily: 30,
} as const;

export type BacktestReason = "ok" | "free_limit_reached" | "daily_limit";

export interface BacktestInput {
  /** Completed backtests this user has run in total. */
  usedTotal: number;
  /** ... and today (UTC). */
  usedToday: number;
  isPro: boolean;
  isAdmin: boolean;
}

export interface BacktestDecision {
  allowed: boolean;
  reason: BacktestReason;
  isPro: boolean;
  /** Runs left (free: of the one included; paid: today). null for admins. */
  remaining: number | null;
  /** The limit remaining counts against (free: total, paid: per day). null for admins. */
  limit: number | null;
  /** Longest window in days for this user (null = the data provider's own limit). */
  maxRangeDays: number | null;
}

export function decideBacktest(i: BacktestInput): BacktestDecision {
  if (i.isAdmin) return { allowed: true, reason: "ok", isPro: true, remaining: null, limit: null, maxRangeDays: null };
  if (i.isPro) {
    const left = Math.max(0, BACKTEST_QUOTA.proDaily - Math.max(0, i.usedToday));
    return { allowed: left > 0, reason: left > 0 ? "ok" : "daily_limit", isPro: true, remaining: left, limit: BACKTEST_QUOTA.proDaily, maxRangeDays: null };
  }
  const left = Math.max(0, BACKTEST_QUOTA.freeTotal - Math.max(0, i.usedTotal));
  return { allowed: left > 0, reason: left > 0 ? "ok" : "free_limit_reached", isPro: false, remaining: left, limit: BACKTEST_QUOTA.freeTotal, maxRangeDays: BACKTEST_QUOTA.freeMaxRangeDays };
}
