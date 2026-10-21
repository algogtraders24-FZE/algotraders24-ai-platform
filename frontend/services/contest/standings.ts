// services/contest/standings.ts
// The demo contest's scoring. Pure: no DB, no network (the caller fetches the deals).
//
// What counts:
//   - ONLY trades of the EA: positions opened with the contest's magic number (balance operations are kept);
//   - ONLY trades CLOSED inside the contest window (broker server time, the same convention as every Live Results page);
//   - profit % is measured against the account balance at the START of the window, so lot size cannot buy a better rank;
//   - the prop-style rules decide eligibility: breaking the daily-loss or max-loss limit (as % of the start balance) takes you out of the
//     prizes (you stay on the board, marked), and you need a minimum number of trading days and trades.
// Known limits (shown on the contest page): terminal-reported closed trades, floating loss is not counted, deposits / withdrawals during the
// window are ignored. Not verified by a broker; winners are checked by AT24 before a licence is issued.
import { dealsToHistory } from "../live-sync/to-trades";
import { computePropCheck, type PropRules } from "../live-results/prop";
import type { DealWithMagic } from "../live-results/build";

export interface ContestRules extends PropRules {
  /** Minimum number of closed EA trades inside the window to be eligible for a prize. */
  minTrades: number;
}

export const DEFAULT_CONTEST_RULES: ContestRules = { profitTargetPct: 100, dailyLossPct: 5, maxLossPct: 10, minTradingDays: 10, minTrades: 20 };

export function readContestRules(v: unknown): ContestRules {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const num = (k: keyof ContestRules, d: number) => (typeof o[k] === "number" && Number.isFinite(o[k] as number) && (o[k] as number) >= 0 ? (o[k] as number) : d);
  return {
    profitTargetPct: num("profitTargetPct", DEFAULT_CONTEST_RULES.profitTargetPct),
    dailyLossPct: num("dailyLossPct", DEFAULT_CONTEST_RULES.dailyLossPct),
    maxLossPct: num("maxLossPct", DEFAULT_CONTEST_RULES.maxLossPct),
    minTradingDays: Math.floor(num("minTradingDays", DEFAULT_CONTEST_RULES.minTradingDays)),
    minTrades: Math.floor(num("minTrades", DEFAULT_CONTEST_RULES.minTrades)),
  };
}

export interface Standing {
  /** false when there is nothing to score yet (no balance at the start, or no deals). */
  scored: boolean;
  profitPct: number;
  trades: number;
  tradingDays: number;
  worstDailyLossPct: number;
  maxLossUsedPct: number;
  brokenRule: "daily_loss" | "max_loss" | null;
  brokenOn: string | null;
  eligible: boolean;
  /** Plain-language reason when not eligible (null when eligible). */
  reason: string | null;
}

const EMPTY: Standing = { scored: false, profitPct: 0, trades: 0, tradingDays: 0, worstDailyLossPct: 0, maxLossUsedPct: 0, brokenRule: null, brokenOn: null, eligible: false, reason: "No trades in the window yet" };

export function computeStanding(
  deals: readonly DealWithMagic[],
  marginMode: string,
  window: { startMs: number; endMs: number },
  magic: string,
  rules: ContestRules,
): Standing {
  // Balance of the WHOLE account at the start (every magic, deposits included): the denominator for profit %.
  const all = dealsToHistory(deals, marginMode);
  const before = all.balanceOps.filter((b) => b.time < window.startMs).reduce((s, b) => s + b.amount, 0) + all.trades.filter((t) => t.closeTime < window.startMs).reduce((s, t) => s + t.net, 0);
  if (!(before > 0)) return { ...EMPTY, reason: "No account balance found before the contest started" };

  const opens = new Map<string, string>();
  for (const d of deals) if (d.entry === "in" && !opens.has(d.positionId)) opens.set(d.positionId, d.magic);
  const kept = deals.filter((d) => d.type === "balance" || opens.get(d.positionId) === magic);
  const hist = dealsToHistory(kept, marginMode);
  const trades = hist.trades.filter((t) => t.closeTime >= window.startMs && t.closeTime < window.endMs);
  if (trades.length === 0) return { ...EMPTY, scored: true, reason: "No closed trades of the EA in the window yet" };

  const check = computePropCheck(trades, [{ time: window.startMs, amount: before }], { ...rules, profitTargetPct: Math.max(rules.profitTargetPct, 0.1) });
  let reason: string | null = null;
  if (check.brokenRule === "daily_loss") reason = `Daily loss limit of ${rules.dailyLossPct}% was broken on ${check.brokenOn}`;
  else if (check.brokenRule === "max_loss") reason = `Max loss limit of ${rules.maxLossPct}% was broken on ${check.brokenOn}`;
  else if (check.tradingDays < rules.minTradingDays) reason = `Needs ${rules.minTradingDays - check.tradingDays} more trading day(s)`;
  else if (trades.length < rules.minTrades) reason = `Needs ${rules.minTrades - trades.length} more closed trade(s)`;
  return {
    scored: true,
    profitPct: check.profitPct,
    trades: trades.length,
    tradingDays: check.tradingDays,
    worstDailyLossPct: check.worstDailyLossPct,
    maxLossUsedPct: check.maxLossUsedPct,
    brokenRule: check.brokenRule,
    brokenOn: check.brokenOn,
    eligible: reason === null,
    reason,
  };
}

export interface RankedRow<T> {
  rank: number | null;
  row: T;
  standing: Standing;
}

/** Eligible entrants first (profit % desc, then smaller max loss, then more trades); everyone else after, unranked. */
export function rankStandings<T>(rows: readonly { row: T; standing: Standing }[]): RankedRow<T>[] {
  const eligible = rows.filter((r) => r.standing.eligible).sort((a, b) => b.standing.profitPct - a.standing.profitPct || a.standing.maxLossUsedPct - b.standing.maxLossUsedPct || b.standing.trades - a.standing.trades);
  const rest = rows.filter((r) => !r.standing.eligible).sort((a, b) => b.standing.profitPct - a.standing.profitPct);
  return [...eligible.map((r, i) => ({ ...r, rank: i + 1 })), ...rest.map((r) => ({ ...r, rank: null }))];
}

/** Alias: 3-24 characters, letters / digits / space / . _ - only. Returns the cleaned alias or null. */
export function cleanAlias(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{2,23}$/.test(s) ? s : null;
}
