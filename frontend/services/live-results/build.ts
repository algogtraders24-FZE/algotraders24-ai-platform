// services/live-results/build.ts
// AT24 Live Results (T2) - builds the PUBLIC view of a results page from raw synced data.
// Pure: no DB, no network. All privacy rules are enforced HERE (data is removed, not hidden in the UI):
//   - showAmounts=false  => no money amounts and no lot sizes leave this function
//   - open positions     => only ones that were already open `positionDelayMin` minutes ago
//   - magic filter       => only positions opened with that magic number (balance operations are kept)
// Everything runs from the first synced event: there is no custom start date.

import type { WirePosition } from "../live-sync/contract";
import { dealsToHistory, type SyncedDeal } from "../live-sync/to-trades";
import { computeLiveResults, perTradeGainPct, windowStats, type LiveResultsStats } from "./stats";
import { computeEdgeEvidence } from "../edge-analyzer/analysis/edge-evidence";
import { normalizeTag } from "../edge-analyzer/analysis/patterns";
import { computeAdvanced, type AdvancedStats } from "./advanced";
import type { ClosedTrade } from "../edge-analyzer/types";

export interface DealWithMagic extends SyncedDeal {
  magic: string;
}

export interface BuildInput {
  page: { title: string; description: string; showAmounts: boolean; positionDelayMin: number; magicFilter: string | null };
  account: {
    mode: string;
    currency: string;
    marginMode: string;
    leverage: number;
    /** Seconds the broker clock is ahead of UTC (to place the first sync on the broker clock). */
    serverUtcOffsetSec: number;
    firstSyncAt: number; // UTC ms
    lastSyncAt: number; // UTC ms
    batches: number;
    chainHead: string;
  };
  deals: readonly DealWithMagic[];
  /** Recent snapshots (UTC ms), any order. Only open positions are used from them. */
  snapshots: readonly { time: number; positions: readonly WirePosition[] }[];
  nowUtc: number;
  /** When the viewer started watching (UTC ms): adds integrity.sinceWatch. */
  sinceUtc?: number;
}

export interface StrategyRow {
  name: string;
  trades: number;
  winRatePct: number;
  profitFactor: number | null;
  /** Share of this page's trades, percent. */
  sharePct: number;
  net?: number;
}

/** One closed trade in the history table. Money-bearing fields exist ONLY when the owner shows amounts. */
export interface HistoryRow {
  closeTime: number;
  openTime: number;
  symbol: string;
  side: "buy" | "sell";
  durationMs: number;
  /** Net result as a percent of the balance just before the trade closed. */
  gainPct: number | null;
  strategy: string;
  volume?: number;
  openPrice?: number;
  closePrice?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  net?: number;
  commission?: number;
  swap?: number;
}

export const HISTORY_ROWS_MAX = 300;

export interface PublicPosition {
  symbol: string;
  side: "buy" | "sell";
  hasStopLoss: boolean;
  hasTakeProfit: boolean;
  volume?: number;
  profit?: number;
}

export interface PublicResults {
  title: string;
  description: string;
  mode: string;
  currency: string;
  marginMode: string;
  /** The header line of the page: facts about the account itself (never the broker, account number or server). */
  account: { platform: string; leverage: number; utcOffsetHours: number; automated: boolean; startedAt: number | null };
  /** Newest first, capped at HISTORY_ROWS_MAX; `total` is the real count. */
  history: { total: number; rows: HistoryRow[] };
  /** Integrity facts shown as badges. */
  integrity: {
    source: "terminal-reported";
    firstSyncAt: number;
    historyStart: number | null;
    daysSinceFirstSync: number;
    lastSyncAt: number;
    stale: boolean;
    batches: number;
    chainHeadShort: string;
    filteredByMagic: string | null;
    accountMagicCount: number;
    gainsDiverge: boolean;
    /** The real forward record: only trades closed AFTER the first sync. */
    liveTracked: { trades: number; gainPct: number | null; winRatePct: number | null };
    /** Only the trades closed since the viewer started watching (percent / counts only). */
    sinceWatch?: { since: number; trades: number; gainPct: number | null; winRatePct: number | null };
  };
  stats: {
    absoluteGainPct: number | null;
    timeWeightedGainPct: number | null;
    maxDrawdownPct: number;
    trades: number;
    winRatePct: number;
    profitFactor: number | null;
    payoffRatio: number | null;
    maxConsecutiveLosses: number;
    avgTradeLengthMs: number | null;
    longsWonPct: number | null;
    shortsWonPct: number | null;
    bestTrade: { time: number; gainPct: number | null } | null;
    worstTrade: { time: number; gainPct: number | null } | null;
    sharpePerTrade: number | null;
    zScore: number | null;
    zConfidencePct: number | null;
    ahprPct: number | null;
    ghprPct: number | null;
    daily: PeriodPublic;
    weekly: PeriodPublic;
    monthly: PeriodPublic;
    yearly: PeriodPublic;
    monthlyHistory: (PeriodPublic & { month: string })[];
    dailyHistory: (PeriodPublic & { date: string })[];
    growth: { t: number; growthPct: number | null; flow?: "deposit" | "withdrawal" }[];
    bySymbol: { symbol: string; trades: number; wonPct: number; longs: number; shorts: number; net?: number }[];
  };
  strategies: StrategyRow[];
  /** Hourly / weekday / risk-of-ruin / duration tabs (counts, percentages and probabilities only). */
  advanced: AdvancedStats;
  edge: { level: string; headline: string; caveats: string[] } | null;
  openPositions: PublicPosition[];
  /** Present only when the owner chose to show amounts. */
  amounts?: {
    balance: number;
    deposits: number;
    withdrawals: number;
    profit: number;
    highestBalance: number | null;
    bestTrade: number | null;
    worstTrade: number | null;
    stdDev: number | null;
    expectancy: number;
    avgWin: number | null;
    avgLoss: number | null;
    commissions: number;
    swap: number;
    lots: number;
    growthBalance: number[];
    /** Cumulative trading profit (balance minus net deposits) aligned with `growth`. */
    cumProfit: number[];
    /** The first deposit, and every deposit/withdrawal (oldest first, max 100): context for any percent figure. */
    initialDeposit: number | null;
    cashflows: { time: number; amount: number }[];
  };
  disclosure: string[];
}

interface PeriodPublic {
  gainPct: number | null;
  trades: number;
  winRatePct: number | null;
  profit?: number;
}

export const STALE_AFTER_MS = 10 * 60_000;

export const DISCLOSURE: readonly string[] = [
  "Reported by the user's own MetaTrader terminal through a read-only AT24 Expert Advisor and stored in an append-only hash chain. It is NOT independently verified by the broker or by AT24.",
  "Closed trades only. Open positions are shown with a delay and without prices. Times are the broker's server time.",
  "No start date can be chosen: every figure runs from the first reported event. Trades before the first sync were reported by the terminal at that moment.",
  "Past results do not predict future results. This is not investment advice or an offer to manage money.",
];

const STRATEGY_SUFFIX = /[\s_-]*(buy|sell|long|short)$/i;
/** "Zenith_Sell" -> "Zenith". Broker auto comments and empty comments are grouped, never shown raw. */
export function strategyName(tag: string): string {
  const n = normalizeTag(tag);
  if (n === "(none)" || n === "(broker auto comment)") return "(untagged)";
  const stripped = n.replace(STRATEGY_SUFFIX, "").trim();
  return stripped.length > 0 ? stripped.slice(0, 40) : "(untagged)";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Percent-only pages must not leak money through free text: drop any sentence that names the account currency or a 2-decimal amount. */
export function withoutMoneyText(text: string, currency: string): string {
  const money = new RegExp(String.raw`\b${currency.replace(/[^A-Za-z]/g, "")}\b|\d[\d,]*\.\d{2}\b`, "i");
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !money.test(sentence))
    .join(" ")
    .trim();
}

function strategiesOf(trades: readonly ClosedTrade[], showAmounts: boolean, max = 12): StrategyRow[] {
  const m = new Map<string, { n: number; wins: number; net: number; gp: number; gl: number }>();
  for (const t of trades) {
    const k = strategyName(t.tag);
    const b = m.get(k) ?? { n: 0, wins: 0, net: 0, gp: 0, gl: 0 };
    b.n++;
    b.net += t.net;
    if (t.profit > 0) {
      b.wins++;
      b.gp += t.net;
    } else if (t.profit < 0) b.gl += -t.net;
    m.set(k, b);
  }
  const total = trades.length || 1;
  const rows = [...m.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .map(([name, b]): StrategyRow => {
      const row: StrategyRow = {
        name,
        trades: b.n,
        winRatePct: r2((b.wins / b.n) * 100),
        profitFactor: b.gl > 0 ? r2(b.gp / b.gl) : null,
        sharePct: r2((b.n / total) * 100),
      };
      if (showAmounts) row.net = r2(b.net);
      return row;
    });
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max - 1);
  const tail = rows.slice(max - 1);
  const n = tail.reduce((s, r) => s + r.trades, 0);
  head.push({ name: "(other)", trades: n, winRatePct: r2((tail.reduce((s, r) => s + (r.winRatePct * r.trades) / 100, 0) / n) * 100), profitFactor: null, sharePct: r2((n / total) * 100) });
  return head;
}

/** Positions of the chosen EA only: match by the magic of the position's opening deal. */
function magicOfPosition(deals: readonly DealWithMagic[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of deals) if (d.entry === "in" && !m.has(d.positionId)) m.set(d.positionId, d.magic);
  return m;
}

export function buildPublicResults(input: BuildInput): PublicResults {
  const { page, account, nowUtc } = input;
  const magicOf = magicOfPosition(input.deals);
  const accountMagicCount = new Set([...magicOf.values()]).size;

  let deals: readonly DealWithMagic[] = input.deals;
  if (page.magicFilter !== null) {
    deals = input.deals.filter((d) => d.type === "balance" || magicOf.get(d.positionId) === page.magicFilter);
  }
  const hist = dealsToHistory(deals);
  const stats: LiveResultsStats = computeLiveResults(hist.trades, hist.balanceOps, null);
  const edge = hist.trades.length >= 2 ? computeEdgeEvidence(hist.trades, { currency: account.currency }) : null;

  const withAmounts = page.showAmounts;
  const period = (p: { gainPct: number | null; trades: number; winRatePct: number | null; profit: number }): PeriodPublic => {
    const o: PeriodPublic = { gainPct: p.gainPct, trades: p.trades, winRatePct: p.winRatePct };
    if (withAmounts) o.profit = p.profit;
    return o;
  };

  // Open positions, delayed and redacted.
  const cutoff = nowUtc - page.positionDelayMin * 60_000;
  const old = [...input.snapshots].filter((s) => s.time <= cutoff).sort((a, b) => b.time - a.time)[0];
  const openPositions: PublicPosition[] = [];
  if (old) {
    for (const p of old.positions) {
      if (page.magicFilter !== null && magicOf.get(String(p.ticket)) !== page.magicFilter) continue;
      const pos: PublicPosition = { symbol: p.symbol, side: p.side, hasStopLoss: p.sl > 0, hasTakeProfit: p.tp > 0 };
      if (withAmounts) {
        pos.volume = p.volume;
        pos.profit = r2(p.profit);
      }
      openPositions.push(pos);
    }
  }

  const gains = perTradeGainPct(hist.trades, hist.balanceOps);
  const byClose = [...hist.trades].sort((a, b) => a.closeTime - b.closeTime);
  const extreme = (t: { net: number; time: number } | null) => {
    if (!t) return null;
    const m = byClose.find((x) => x.closeTime === t.time && r2(x.net) === t.net);
    return { time: t.time, gainPct: m ? (gains.get(m.positionId) ?? null) : null };
  };
  const historyRows: HistoryRow[] = byClose
    .slice(-HISTORY_ROWS_MAX)
    .reverse()
    .map((t) => {
      const row: HistoryRow = {
        closeTime: t.closeTime,
        openTime: t.openTime,
        symbol: t.symbol,
        side: t.direction,
        durationMs: Math.max(0, t.closeTime - t.openTime),
        gainPct: gains.get(t.positionId) ?? null,
        strategy: strategyName(t.tag),
      };
      if (withAmounts) {
        row.volume = t.volume;
        row.openPrice = t.openPrice;
        row.closePrice = t.closePrice;
        row.stopLoss = t.stopLoss;
        row.takeProfit = t.takeProfit;
        row.net = r2(t.net);
        row.commission = r2(t.commission);
        row.swap = r2(t.swap);
      }
      return row;
    });
  const automated = [...magicOf.values()].some((m) => m !== "0" && m !== "");

  const growth = stats.growth.map((g) => {
    const o: PublicResults["stats"]["growth"][number] = { t: g.t, growthPct: g.growthPct };
    if (g.flow !== undefined) o.flow = g.flow > 0 ? "deposit" : "withdrawal";
    return o;
  });

  const out: PublicResults = {
    title: page.title,
    description: page.description,
    mode: account.mode,
    currency: account.currency,
    marginMode: account.marginMode,
    account: { platform: "MetaTrader 5", leverage: account.leverage, utcOffsetHours: Math.round((account.serverUtcOffsetSec / 3600) * 100) / 100, automated, startedAt: stats.firstEventTime },
    history: { total: hist.trades.length, rows: historyRows },
    integrity: {
      source: "terminal-reported",
      firstSyncAt: account.firstSyncAt,
      historyStart: stats.firstEventTime,
      daysSinceFirstSync: Math.max(0, Math.floor((nowUtc - account.firstSyncAt) / 86_400_000)),
      lastSyncAt: account.lastSyncAt,
      stale: nowUtc - account.lastSyncAt > STALE_AFTER_MS,
      batches: account.batches,
      chainHeadShort: account.chainHead.slice(0, 12),
      filteredByMagic: page.magicFilter,
      accountMagicCount,
      gainsDiverge: stats.gainsDiverge,
      liveTracked: (() => {
        const w = windowStats(hist.trades, hist.balanceOps, account.firstSyncAt + account.serverUtcOffsetSec * 1000);
        return { trades: w.trades, gainPct: w.gainPct, winRatePct: w.winRatePct };
      })(),
      sinceWatch: input.sinceUtc === undefined ? undefined : (() => {
        const w = windowStats(hist.trades, hist.balanceOps, input.sinceUtc + account.serverUtcOffsetSec * 1000);
        return { since: input.sinceUtc, trades: w.trades, gainPct: w.gainPct, winRatePct: w.winRatePct };
      })(),
    },
    stats: {
      absoluteGainPct: stats.absoluteGainPct,
      timeWeightedGainPct: stats.timeWeightedGainPct,
      maxDrawdownPct: stats.core.maxDrawdownPct,
      trades: stats.core.tradeCount,
      winRatePct: stats.core.winRatePct,
      profitFactor: stats.core.profitFactor,
      payoffRatio: stats.core.payoffRatio,
      maxConsecutiveLosses: stats.core.maxConsecutiveLosses,
      avgTradeLengthMs: stats.trade.avgTradeLengthMs,
      longsWonPct: stats.trade.longs.pct,
      shortsWonPct: stats.trade.shorts.pct,
      bestTrade: extreme(stats.trade.bestTrade),
      worstTrade: extreme(stats.trade.worstTrade),
      sharpePerTrade: stats.trade.sharpePerTrade,
      zScore: stats.trade.zScore,
      zConfidencePct: stats.trade.zConfidencePct,
      ahprPct: stats.trade.ahprPct,
      ghprPct: stats.trade.ghprPct,
      daily: period(stats.daily),
      weekly: period(stats.weekly),
      monthly: period(stats.monthly),
      yearly: period(stats.yearly),
      monthlyHistory: stats.monthlyHistory.map((m) => ({ month: m.month, ...period(m) })),
      dailyHistory: stats.dailyHistory.map((d) => ({ date: d.date, ...period(d) })),
      growth,
      bySymbol: stats.bySymbol.map((s) => {
        const o: PublicResults["stats"]["bySymbol"][number] = { symbol: s.symbol, trades: s.total.trades, wonPct: s.total.wonPct, longs: s.longs.trades, shorts: s.shorts.trades };
        if (withAmounts) o.net = s.total.profit;
        return o;
      }),
    },
    strategies: strategiesOf(hist.trades, withAmounts),
    advanced: computeAdvanced(hist.trades, hist.balanceOps, stats.balance, stats.core.maxConsecutiveLosses, withAmounts),
    edge: edge
      ? withAmounts
        ? { level: edge.level, headline: edge.headline, caveats: edge.caveats }
        : {
            level: edge.level,
            headline: withoutMoneyText(edge.headline, account.currency) || `${edge.level.charAt(0).toUpperCase()}${edge.level.slice(1)} evidence of an edge (see the caveats).`,
            caveats: edge.caveats.map((c) => withoutMoneyText(c, account.currency)).filter((c) => c.length > 0),
          }
      : null,
    openPositions,
    disclosure: [...DISCLOSURE],
  };

  if (withAmounts) {
    out.amounts = {
      balance: stats.balance,
      deposits: stats.deposits,
      withdrawals: stats.withdrawals,
      profit: stats.core.netProfit,
      highestBalance: stats.highestBalance ? stats.highestBalance.balance : null,
      bestTrade: stats.trade.bestTrade ? stats.trade.bestTrade.net : null,
      worstTrade: stats.trade.worstTrade ? stats.trade.worstTrade.net : null,
      stdDev: stats.trade.stdDev,
      expectancy: stats.core.expectancy,
      avgWin: stats.core.avgWin,
      avgLoss: stats.core.avgLoss,
      commissions: stats.trade.commissions,
      swap: stats.trade.swap,
      lots: stats.trade.lots,
      growthBalance: stats.growth.map((g) => g.balance),
      cumProfit: (() => {
        let flows = 0;
        return stats.growth.map((g) => {
          if (g.flow !== undefined) flows += g.flow;
          return r2(g.balance - flows);
        });
      })(),
      initialDeposit: hist.balanceOps[0] && hist.balanceOps[0].amount > 0 ? hist.balanceOps[0].amount : null,
      cashflows: hist.balanceOps.slice(0, 100).map((o) => ({ time: o.time, amount: o.amount })),
    };
  }
  return out;
}
