// services/live-results/stats.ts
// AT24 Live Results (T1) - the pure statistics behind a public/private results page.
// Input: closed trades + balance operations (from live-sync `dealsToHistory`). No DB, no network.
// Descriptive only. Times are broker server time read as naive UTC (same convention as the Edge Analyzer).
//
// Integrity rules baked in: there is NO custom start date - everything runs from the first event;
// gain is reported two ways (absolute = profit / deposits, and time-weighted so a tiny first deposit
// followed by a big one cannot inflate it).

import type { BalanceOp, ClosedTrade } from "../edge-analyzer/types";
import { computeCoreStats, type CoreStats } from "../edge-analyzer/analysis/core";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const DAY = 86_400_000;

export interface LedgerEvent {
  time: number;
  delta: number;
  flow: boolean;
}

function events(trades: readonly ClosedTrade[], ops: readonly BalanceOp[]): LedgerEvent[] {
  const ev: LedgerEvent[] = [
    ...ops.map((o) => ({ time: o.time, delta: o.amount, flow: true })),
    ...trades.map((t) => ({ time: t.closeTime, delta: t.net, flow: false })),
  ];
  // Stable order: by time; at equal time, flows first so a deposit and a trade at the same instant are not mixed up.
  return ev.sort((a, b) => a.time - b.time || Number(b.flow) - Number(a.flow));
}

/** Time-weighted return (percent) over [from, to): chain-links sub-periods split at external flows. null if undefined. */
export function timeWeightedGain(ev: readonly LedgerEvent[], from: number, to: number): number | null {
  let cur = 0;
  let i = 0;
  while (i < ev.length && ev[i].time < from) cur += ev[i++].delta;
  let start = cur;
  let product = 1;
  let anyPeriod = false;
  for (; i < ev.length && ev[i].time < to; i++) {
    const e = ev[i];
    if (e.flow) {
      if (start > 0) {
        product *= cur / start;
        anyPeriod = true;
      }
      cur += e.delta;
      start = cur;
    } else {
      cur += e.delta;
    }
  }
  if (start > 0) {
    product *= cur / start;
    anyPeriod = true;
  }
  return anyPeriod ? r2((product - 1) * 100) : null;
}

export interface PeriodRow {
  gainPct: number | null;
  profit: number;
  trades: number;
  winRatePct: number | null;
  lots: number;
}

export interface MonthRow extends PeriodRow {
  month: string; // YYYY-MM (broker time)
}

export interface SymbolRow {
  symbol: string;
  longs: { trades: number; profit: number };
  shorts: { trades: number; profit: number };
  total: { trades: number; profit: number; won: number; lost: number; wonPct: number };
}

export interface GrowthPoint {
  t: number;
  balance: number;
  /** Cumulative time-weighted growth since the first event, percent. */
  growthPct: number | null;
  /** Set on deposit (+) / withdrawal (-) markers. */
  flow?: number;
}

export interface TradeStats {
  stdDev: number | null;
  /** Mean net per trade / sample SD of net per trade. Per-trade, not annualized. */
  sharpePerTrade: number | null;
  bestTrade: { net: number; time: number } | null;
  worstTrade: { net: number; time: number } | null;
  avgTradeLengthMs: number | null;
  longs: { won: number; total: number; pct: number | null };
  shorts: { won: number; total: number; pct: number | null };
  /** Wald-Wolfowitz runs test on win/loss sequence. Descriptive: negative = streaks, positive = alternation. */
  zScore: number | null;
  zConfidencePct: number | null;
  /** Average / geometric holding-period return per trade (net / balance before the trade), percent. */
  ahprPct: number | null;
  ghprPct: number | null;
  commissions: number;
  swap: number;
  lots: number;
}

export interface LiveResultsStats {
  core: CoreStats;
  deposits: number;
  withdrawals: number;
  /** deposits - withdrawals + profit (closed trades only). */
  balance: number;
  /** profit / deposits, percent. */
  absoluteGainPct: number | null;
  /** Chain-linked, flow-adjusted, percent. */
  timeWeightedGainPct: number | null;
  /** True when absolute and time-weighted gain differ by 10+ percentage points: capital changed a lot, read both. */
  gainsDiverge: boolean;
  daily: PeriodRow;
  weekly: PeriodRow;
  monthly: PeriodRow;
  yearly: PeriodRow;
  highestBalance: { balance: number; time: number } | null;
  monthlyHistory: MonthRow[];
  /** One row per broker day for the last 120 days (zero-activity days included, so a chart is continuous). */
  dailyHistory: (PeriodRow & { date: string })[];
  bySymbol: SymbolRow[];
  trade: TradeStats;
  growth: GrowthPoint[];
  firstEventTime: number | null;
  lastEventTime: number | null;
  assumptions: string[];
}

export const RESULTS_ASSUMPTIONS: readonly string[] = [
  "Closed trades only; floating (open) profit/loss is not part of these numbers.",
  "Times are the broker's server time, not UTC.",
  "Absolute gain = profit / total deposits (not fooled by a small first deposit followed by a large one). Time-weighted gain = return per unit of capital with deposits and withdrawals removed (an early period on a small balance still counts fully). When they differ by 10+ points, read both.",
  "There is no custom start date: every figure runs from the first synced event.",
  "Pips, pending orders and per-trade excursion (MAE/MFE) are not available yet.",
  "Descriptive only: past results do not predict future results and nothing here is investment advice.",
];

function periodRow(trades: readonly ClosedTrade[], ev: readonly LedgerEvent[], from: number, to: number): PeriodRow {
  const inP = trades.filter((t) => t.closeTime >= from && t.closeTime < to);
  const wins = inP.filter((t) => t.profit > 0).length;
  return {
    gainPct: timeWeightedGain(ev, from, to),
    profit: r2(inP.reduce((s, t) => s + t.net, 0)),
    trades: inP.length,
    winRatePct: inP.length ? r2((wins / inP.length) * 100) : null,
    lots: r2(inP.reduce((s, t) => s + t.volume, 0)),
  };
}

/** Stats for the window [from, to) (broker time): used for "since live tracking started". */
export function windowStats(trades: readonly ClosedTrade[], balanceOps: readonly BalanceOp[], from: number, to = Number.POSITIVE_INFINITY): PeriodRow {
  const ops = [...balanceOps].sort((a, b) => a.time - b.time);
  return periodRow(trades, events(trades, ops), from, to);
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
function nextMonth(start: number): number {
  const d = new Date(start);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 via erf
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function runsZ(trades: readonly ClosedTrade[]): { z: number | null; conf: number | null } {
  const seq = trades.filter((t) => t.profit !== 0).map((t) => t.profit > 0);
  const n = seq.length;
  const w = seq.filter(Boolean).length;
  const l = n - w;
  if (n < 10 || w === 0 || l === 0) return { z: null, conf: null };
  let runs = 1;
  for (let i = 1; i < n; i++) if (seq[i] !== seq[i - 1]) runs++;
  const x = 2 * w * l;
  const denom = Math.sqrt((x * (x - n)) / (n - 1));
  if (!(denom > 0)) return { z: null, conf: null };
  const z = (n * (runs - 0.5) - x) / denom;
  const conf = (1 - 2 * (1 - normalCdf(Math.abs(z)))) * 100;
  return { z: r2(z), conf: r2(Math.max(0, Math.min(100, conf))) };
}

export function computeLiveResults(trades: readonly ClosedTrade[], balanceOps: readonly BalanceOp[], nowBroker: number | null = null): LiveResultsStats {
  const ops = [...balanceOps].sort((a, b) => a.time - b.time);
  const ev = events(trades, ops);
  const firstDeposit = ops[0] && ops[0].amount > 0 ? ops[0].amount : 0;
  const core = computeCoreStats(trades, firstDeposit, ops);

  const deposits = r2(ops.filter((o) => o.amount > 0).reduce((s, o) => s + o.amount, 0));
  const withdrawals = r2(ops.filter((o) => o.amount < 0).reduce((s, o) => s - o.amount, 0));
  const profit = trades.reduce((s, t) => s + t.net, 0);
  const balance = r2(deposits - withdrawals + profit);

  const first = ev.length ? ev[0].time : null;
  const last = ev.length ? ev[ev.length - 1].time : null;
  const now = nowBroker ?? last ?? 0;
  const dayStart = Math.floor(now / DAY) * DAY;
  const dow = new Date(dayStart).getUTCDay(); // 0 Sun
  const weekStart = dayStart - ((dow + 6) % 7) * DAY; // Monday
  const mStart = monthStart(now);
  const yStart = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  const END = Number.POSITIVE_INFINITY;

  // Monthly history
  const monthlyHistory: MonthRow[] = [];
  if (first !== null && last !== null) {
    for (let m = monthStart(first); m <= last; m = nextMonth(m)) {
      monthlyHistory.push({ month: monthKey(m), ...periodRow(trades, ev, m, nextMonth(m)) });
    }
  }

  const dailyHistory: LiveResultsStats["dailyHistory"] = [];
  if (first !== null && last !== null) {
    const lastDay = Math.floor(last / DAY) * DAY;
    for (let d = Math.max(Math.floor(first / DAY) * DAY, lastDay - 119 * DAY); d <= lastDay; d += DAY) {
      dailyHistory.push({ date: new Date(d).toISOString().slice(0, 10), ...periodRow(trades, ev, d, d + DAY) });
    }
  }

  // Highest balance + growth series (closed-trade balance, flows included)
  let cur = 0, hi: { balance: number; time: number } | null = null;
  let start = 0, product = 1;
  const growth: GrowthPoint[] = [];
  for (const e of ev) {
    if (e.flow) {
      if (start > 0) product *= cur / start;
      cur += e.delta;
      start = cur;
      growth.push({ t: e.time, balance: r2(cur), growthPct: start > 0 || product !== 1 ? r2((product - 1) * 100) : null, flow: e.delta });
    } else {
      cur += e.delta;
      growth.push({ t: e.time, balance: r2(cur), growthPct: start > 0 ? r2((product * (cur / start) - 1) * 100) : null });
    }
    if (hi === null || cur > hi.balance) hi = { balance: r2(cur), time: e.time };
  }
  const MAX_POINTS = 400;
  let series = growth;
  if (growth.length > MAX_POINTS) {
    const step = Math.ceil(growth.length / MAX_POINTS);
    series = growth.filter((p, i) => p.flow !== undefined || i % step === 0 || i === growth.length - 1);
  }

  // Per-symbol summary
  const sym = new Map<string, SymbolRow>();
  for (const t of trades) {
    const s = sym.get(t.symbol) ?? { symbol: t.symbol, longs: { trades: 0, profit: 0 }, shorts: { trades: 0, profit: 0 }, total: { trades: 0, profit: 0, won: 0, lost: 0, wonPct: 0 } };
    const side = t.direction === "buy" ? s.longs : s.shorts;
    side.trades++;
    side.profit += t.net;
    s.total.trades++;
    s.total.profit += t.net;
    if (t.profit > 0) s.total.won++;
    else if (t.profit < 0) s.total.lost++;
    sym.set(t.symbol, s);
  }
  const bySymbol = [...sym.values()]
    .map((s) => ({
      ...s,
      longs: { trades: s.longs.trades, profit: r2(s.longs.profit) },
      shorts: { trades: s.shorts.trades, profit: r2(s.shorts.profit) },
      total: { ...s.total, profit: r2(s.total.profit), wonPct: s.total.trades ? r2((s.total.won / s.total.trades) * 100) : 0 },
    }))
    .sort((a, b) => b.total.trades - a.total.trades || a.symbol.localeCompare(b.symbol));

  // Trade stats
  const nets = trades.map((t) => t.net);
  const mean = nets.length ? nets.reduce((s, x) => s + x, 0) / nets.length : 0;
  const sd = nets.length > 1 ? Math.sqrt(nets.reduce((s, x) => s + (x - mean) ** 2, 0) / (nets.length - 1)) : null;
  const sortedByClose = [...trades].sort((a, b) => a.closeTime - b.closeTime);
  let best: TradeStats["bestTrade"] = null, worst: TradeStats["worstTrade"] = null;
  for (const t of sortedByClose) {
    if (best === null || t.net > best.net) best = { net: r2(t.net), time: t.closeTime };
    if (worst === null || t.net < worst.net) worst = { net: r2(t.net), time: t.closeTime };
  }
  const dir = (d: "buy" | "sell") => {
    const all = trades.filter((t) => t.direction === d);
    const won = all.filter((t) => t.profit > 0).length;
    return { won, total: all.length, pct: all.length ? r2((won / all.length) * 100) : null };
  };
  // Holding-period returns: net / balance before the trade (running closed-trade balance incl. flows)
  let run = 0;
  const rets: number[] = [];
  for (const e of ev) {
    if (!e.flow) {
      if (run > 0) rets.push(e.delta / run);
    }
    run += e.delta;
  }
  const ahpr = rets.length ? (rets.reduce((s, x) => s + x, 0) / rets.length) * 100 : null;
  const ghpr = rets.length && rets.every((x) => 1 + x > 0) ? (Math.exp(rets.reduce((s, x) => s + Math.log(1 + x), 0) / rets.length) - 1) * 100 : null;
  const rz = runsZ(sortedByClose);

  const trade: TradeStats = {
    stdDev: sd === null ? null : r2(sd),
    sharpePerTrade: sd && sd > 0 ? r4(mean / sd) : null,
    bestTrade: best,
    worstTrade: worst,
    avgTradeLengthMs: trades.length ? Math.round(trades.reduce((s, t) => s + (t.closeTime - t.openTime), 0) / trades.length) : null,
    longs: dir("buy"),
    shorts: dir("sell"),
    zScore: rz.z,
    zConfidencePct: rz.conf,
    ahprPct: ahpr === null ? null : r4(ahpr),
    ghprPct: ghpr === null ? null : r4(ghpr),
    commissions: r2(trades.reduce((s, t) => s + t.commission, 0)),
    swap: r2(trades.reduce((s, t) => s + t.swap, 0)),
    lots: r2(trades.reduce((s, t) => s + t.volume, 0)),
  };

  const absGain = deposits > 0 ? r2((profit / deposits) * 100) : null;
  const twr = first === null ? null : timeWeightedGain(ev, -Infinity, END);
  return {
    core,
    deposits,
    withdrawals,
    balance,
    absoluteGainPct: absGain,
    timeWeightedGainPct: twr,
    gainsDiverge: absGain !== null && twr !== null && Math.abs(absGain - twr) >= 10,
    daily: periodRow(trades, ev, dayStart, END),
    weekly: periodRow(trades, ev, weekStart, END),
    monthly: periodRow(trades, ev, mStart, END),
    yearly: periodRow(trades, ev, yStart, END),
    highestBalance: hi,
    monthlyHistory,
    dailyHistory,
    bySymbol,
    trade,
    growth: series,
    firstEventTime: first,
    lastEventTime: last,
    assumptions: [...RESULTS_ASSUMPTIONS],
  };
}
