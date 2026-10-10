// services/live-sync/portfolio.ts
// AT24 "My portfolio" (Myfxbook-style Portfolio page): ALL of one user's synced accounts in one table, with totals and a
// growth chart. Pure: no DB, no network. It is the OWNER's own data (session-scoped, amounts shown), so nothing is redacted.
//
// Honest totals: demo and real accounts are NEVER pooled together (a demo balance must not inflate a real one), and different
// currencies are never added. Each group (real/demo x currency) is pooled by merging its accounts' trades and deposits, so its
// gain is a real time-weighted figure of the pooled money, not an average of percentages.

import { dealsToHistory, type SyncedDeal } from "./to-trades";
import { computeLiveResults, type PeriodRow } from "../live-results/stats";
import type { ClosedTrade, BalanceOp } from "../edge-analyzer/types";

export const STALE_AFTER_MS = 10 * 60_000;
export const GROWTH_POINTS = 60;

export interface PortfolioAccountInput {
  id: string;
  label: string;
  mode: string;
  platform: string;
  broker: string | null;
  currency: string;
  marginMode: string;
  /** Seconds the broker clock is ahead of UTC. */
  serverUtcOffsetSec: number;
  firstSyncAt: number;
  lastSyncAt: number;
  /** Balance and equity from the latest snapshot (the terminal's own figures), if any. */
  lastBalance: number | null;
  lastEquity: number | null;
  deals: readonly SyncedDeal[];
}

export interface GrowthPoint {
  t: number;
  v: number;
}

export interface PortfolioRow {
  id: string;
  label: string;
  mode: string;
  platform: string;
  broker: string | null;
  currency: string;
  stale: boolean;
  lastSyncAt: number;
  trades: number;
  winRatePct: number | null;
  /** Time-weighted gain since the first synced event, percent. */
  gainPct: number | null;
  /** Profit / deposits, percent. */
  absoluteGainPct: number | null;
  /** Today (broker day) and this month, percent. */
  dailyPct: number | null;
  monthlyPct: number | null;
  maxDrawdownPct: number | null;
  /** The terminal's balance and equity at the last sync (falls back to the closed-trade balance). */
  balance: number;
  equity: number | null;
  /** Closed-trade profit and total deposits / withdrawals. */
  profit: number;
  deposits: number;
  withdrawals: number;
  growth: GrowthPoint[];
}

export interface PeriodPublic {
  gainPct: number | null;
  profit: number;
  trades: number;
  winRatePct: number | null;
}

export interface PortfolioGroup {
  key: string;
  title: string;
  mode: "real" | "demo";
  currency: string;
  accounts: number;
  trades: number;
  winRatePct: number | null;
  gainPct: number | null;
  absoluteGainPct: number | null;
  maxDrawdownPct: number | null;
  balance: number;
  equity: number | null;
  profit: number;
  deposits: number;
  withdrawals: number;
  periods: { today: PeriodPublic; week: PeriodPublic; month: PeriodPublic; year: PeriodPublic };
}

export interface Portfolio {
  generatedAt: number;
  rows: PortfolioRow[];
  groups: PortfolioGroup[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const modeOf = (m: string): "real" | "demo" => (m === "real" ? "real" : "demo");

function period(p: PeriodRow): PeriodPublic {
  return { gainPct: p.gainPct, profit: p.profit, trades: p.trades, winRatePct: p.winRatePct };
}

function downsample(points: readonly GrowthPoint[], max = GROWTH_POINTS): GrowthPoint[] {
  if (points.length <= max) return [...points];
  const out: GrowthPoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]!);
  return out;
}

interface Computed {
  input: PortfolioAccountInput;
  trades: ClosedTrade[];
  ops: BalanceOp[];
  nowBroker: number;
}

export function buildPortfolio(inputs: readonly PortfolioAccountInput[], nowUtc: number): Portfolio {
  const computed: Computed[] = inputs.map((input) => {
    const h = dealsToHistory(input.deals, input.marginMode);
    return { input, trades: h.trades, ops: h.balanceOps, nowBroker: nowUtc + input.serverUtcOffsetSec * 1000 };
  });

  const rows: PortfolioRow[] = computed.map((c) => {
    const s = computeLiveResults(c.trades, c.ops, c.nowBroker);
    const growth = downsample(s.growth.filter((g) => g.growthPct !== null).map((g) => ({ t: g.t, v: g.growthPct as number })));
    return {
      id: c.input.id,
      label: c.input.label,
      mode: c.input.mode,
      platform: c.input.platform,
      broker: c.input.broker,
      currency: c.input.currency,
      stale: nowUtc - c.input.lastSyncAt > STALE_AFTER_MS,
      lastSyncAt: c.input.lastSyncAt,
      trades: s.core.tradeCount,
      winRatePct: s.core.tradeCount > 0 ? s.core.winRatePct : null,
      gainPct: s.timeWeightedGainPct,
      absoluteGainPct: s.absoluteGainPct,
      dailyPct: s.daily.gainPct,
      monthlyPct: s.monthly.gainPct,
      maxDrawdownPct: s.core.tradeCount > 0 ? s.core.maxDrawdownPct : null,
      balance: c.input.lastBalance ?? s.balance,
      equity: c.input.lastEquity,
      profit: r2(s.core.netProfit),
      deposits: s.deposits,
      withdrawals: s.withdrawals,
      growth,
    };
  });

  // Pool each (real|demo, currency) group.
  const byKey = new Map<string, Computed[]>();
  for (const c of computed) {
    const key = `${modeOf(c.input.mode)}|${c.input.currency}`;
    byKey.set(key, [...(byKey.get(key) ?? []), c]);
  }
  const groups: PortfolioGroup[] = [];
  for (const [key, list] of byKey) {
    const [mode, currency] = key.split("|") as ["real" | "demo", string];
    const trades = list.flatMap((c) => c.trades);
    const ops = list.flatMap((c) => c.ops);
    const newest = [...list].sort((a, b) => b.input.lastSyncAt - a.input.lastSyncAt)[0]!;
    const s = computeLiveResults(trades, ops, newest.nowBroker);
    const mine = rows.filter((r) => list.some((c) => c.input.id === r.id));
    const equities = mine.map((r) => r.equity);
    groups.push({
      key,
      title: `${mode === "real" ? "Real" : "Demo"} accounts (${currency})`,
      mode,
      currency,
      accounts: list.length,
      trades: s.core.tradeCount,
      winRatePct: s.core.tradeCount > 0 ? s.core.winRatePct : null,
      gainPct: s.timeWeightedGainPct,
      absoluteGainPct: s.absoluteGainPct,
      maxDrawdownPct: s.core.tradeCount > 0 ? s.core.maxDrawdownPct : null,
      balance: r2(mine.reduce((a, r) => a + r.balance, 0)),
      equity: equities.every((e) => e !== null) ? r2(equities.reduce((a, e) => a + (e as number), 0)) : null,
      profit: r2(s.core.netProfit),
      deposits: s.deposits,
      withdrawals: s.withdrawals,
      periods: { today: period(s.daily), week: period(s.weekly), month: period(s.monthly), year: period(s.yearly) },
    });
  }
  // Real before demo, then by currency.
  groups.sort((a, b) => (a.mode === b.mode ? a.currency.localeCompare(b.currency) : a.mode === "real" ? -1 : 1));
  return { generatedAt: nowUtc, rows, groups };
}
