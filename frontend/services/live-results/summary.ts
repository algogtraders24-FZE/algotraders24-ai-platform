// services/live-results/summary.ts
// AT24 Live Results - the compact, PERCENT-ONLY summary of a public page, used by the directory, the Compare view, the
// public JSON API and the MCP tool. Pure: it only reads an already-redacted PublicResults, so it can never carry money
// (amounts, lots, prices) even when the page owner chose to show them on the page itself.
//
// Deliberately NO score and NO rank: a leaderboard by gain rewards risk-taking and gaming. The directory sorts by
// things that are facts about the track record (age, number of trades, drawdown), and every summary says whether
// the record is long enough to judge (`enoughData`).

import type { PublicResults } from "./build";

/** Below this many closed trades a percent figure says very little. */
export const MIN_TRADES_TO_JUDGE = 30;
export const SPARKLINE_POINTS = 40;

export interface ResultsSummary {
  slug: string;
  title: string;
  description: string;
  mode: string;
  platform: "mt4" | "mt5";
  /** Broker company name, only when the owner chose to show it. Self-reported. */
  broker: string | null;
  oneEa: boolean;
  daysSinceFirstSync: number;
  lastSyncAt: number;
  stale: boolean;
  trades: number;
  winRatePct: number | null;
  profitFactor: number | null;
  /** Time-weighted gain since the first synced event (deposits and withdrawals removed), percent. */
  gainPct: number | null;
  /** Profit / deposits, percent. */
  absoluteGainPct: number | null;
  maxDrawdownPct: number | null;
  /** This calendar month and this calendar year, percent. */
  monthlyPct: number | null;
  yearlyPct: number | null;
  /** Mean gain of the finished months (the running month only when it is the only one), percent. */
  avgMonthlyPct: number | null;
  /** The real forward record: trades closed after the first sync. */
  liveForward: { trades: number; gainPct: number | null };
  /** Growth in percent, at most SPARKLINE_POINTS points, oldest first. */
  sparkline: number[];
  /** True when there are at least MIN_TRADES_TO_JUDGE closed trades. */
  enoughData: boolean;
  /** "weak" / "moderate" / ... from the skill-vs-luck engine, or null. */
  edgeLevel: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function downsample(values: readonly number[], max = SPARKLINE_POINTS): number[] {
  if (values.length <= max) return values.map(r2);
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(r2(values[Math.round((i * (values.length - 1)) / (max - 1))]!));
  return out;
}

export function summarizeResults(slug: string, r: PublicResults): ResultsSummary {
  const s = r.stats;
  const finished = s.monthlyHistory.slice(0, -1).map((m) => m.gainPct).filter((g): g is number => g !== null);
  const onlyRunning = s.monthlyHistory.map((m) => m.gainPct).filter((g): g is number => g !== null);
  const monthsForAvg = finished.length > 0 ? finished : onlyRunning;
  const avg = monthsForAvg.length > 0 ? r2(monthsForAvg.reduce((a, b) => a + b, 0) / monthsForAvg.length) : null;
  const growth = s.growth.filter((g) => g.growthPct !== null).map((g) => g.growthPct as number);
  return {
    slug,
    title: r.title,
    description: r.description,
    mode: r.mode,
    platform: r.account.platform.includes("4") ? "mt4" : "mt5",
    broker: r.account.broker ?? null,
    oneEa: r.integrity.filteredByMagic !== null,
    daysSinceFirstSync: r.integrity.daysSinceFirstSync,
    lastSyncAt: r.integrity.lastSyncAt,
    stale: r.integrity.stale,
    trades: s.trades,
    winRatePct: s.trades > 0 ? s.winRatePct : null,
    profitFactor: s.profitFactor,
    gainPct: s.timeWeightedGainPct,
    absoluteGainPct: s.absoluteGainPct,
    maxDrawdownPct: s.trades > 0 ? s.maxDrawdownPct : null,
    monthlyPct: s.monthly.gainPct,
    yearlyPct: s.yearly.gainPct,
    avgMonthlyPct: avg,
    liveForward: { trades: r.integrity.liveTracked.trades, gainPct: r.integrity.liveTracked.gainPct },
    sparkline: downsample(growth),
    enoughData: s.trades >= MIN_TRADES_TO_JUDGE,
    edgeLevel: r.edge ? r.edge.level : null,
  };
}

export type DirectorySort = "newest" | "longest" | "trades" | "drawdown" | "name";

export const DIRECTORY_SORTS: readonly { id: DirectorySort; label: string }[] = [
  { id: "newest", label: "Recently updated" },
  { id: "longest", label: "Longest tracked" },
  { id: "trades", label: "Most trades" },
  { id: "drawdown", label: "Lowest drawdown" },
  { id: "name", label: "Name (A-Z)" },
];

export interface DirectoryFilter {
  query: string;
  mode: "all" | "demo" | "real";
  platform: "all" | "mt4" | "mt5";
  liveOnly: boolean;
  enoughOnly: boolean;
}

export const DEFAULT_FILTER: DirectoryFilter = { query: "", mode: "all", platform: "all", liveOnly: false, enoughOnly: false };

/** Filters then sorts. There is intentionally no sort by gain. */
export function filterAndSort(items: readonly ResultsSummary[], filter: DirectoryFilter, sort: DirectorySort): ResultsSummary[] {
  const q = filter.query.trim().toLowerCase();
  const out = items.filter((p) => {
    if (q && !`${p.title} ${p.description} ${p.broker ?? ""}`.toLowerCase().includes(q)) return false;
    if (filter.mode !== "all" && p.mode !== filter.mode) return false;
    if (filter.platform !== "all" && p.platform !== filter.platform) return false;
    if (filter.liveOnly && p.stale) return false;
    if (filter.enoughOnly && !p.enoughData) return false;
    return true;
  });
  const dd = (p: ResultsSummary) => (p.maxDrawdownPct === null ? Number.POSITIVE_INFINITY : p.maxDrawdownPct);
  const cmp: Record<DirectorySort, (a: ResultsSummary, b: ResultsSummary) => number> = {
    newest: (a, b) => b.lastSyncAt - a.lastSyncAt,
    longest: (a, b) => b.daysSinceFirstSync - a.daysSinceFirstSync,
    trades: (a, b) => b.trades - a.trades,
    drawdown: (a, b) => dd(a) - dd(b),
    name: (a, b) => a.title.localeCompare(b.title),
  };
  return [...out].sort((a, b) => cmp[sort](a, b) || a.title.localeCompare(b.title));
}

export const MAX_COMPARE = 4;

/** Rows of the side-by-side table (label + one formatted cell per page). Percent only. */
export function compareRows(items: readonly ResultsSummary[]): { label: string; cells: string[] }[] {
  const pct = (n: number | null) => (n === null ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
  const plain = (n: number | null, d = 2) => (n === null ? "-" : n.toFixed(d));
  const row = (label: string, f: (p: ResultsSummary) => string) => ({ label, cells: items.map(f) });
  return [
    row("Account", (p) => (p.mode === "real" ? "REAL" : p.mode === "contest" ? "CONTEST" : "DEMO")),
    row("Platform", (p) => (p.platform === "mt4" ? "MetaTrader 4" : "MetaTrader 5")),
    row("Broker (self-reported)", (p) => p.broker ?? "not shown"),
    row("Tracked", (p) => `${p.daysSinceFirstSync} days`),
    row("Closed trades", (p) => String(p.trades)),
    row("Enough trades to judge", (p) => (p.enoughData ? "yes" : `no (under ${MIN_TRADES_TO_JUDGE})`)),
    row("Win rate", (p) => (p.winRatePct === null ? "-" : `${p.winRatePct.toFixed(2)}%`)),
    row("Profit factor", (p) => plain(p.profitFactor)),
    row("Time-weighted gain", (p) => pct(p.gainPct)),
    row("Absolute gain", (p) => pct(p.absoluteGainPct)),
    row("Max drawdown", (p) => (p.maxDrawdownPct === null ? "-" : `${p.maxDrawdownPct.toFixed(2)}%`)),
    row("This month", (p) => pct(p.monthlyPct)),
    row("This year", (p) => pct(p.yearlyPct)),
    row("Average month", (p) => pct(p.avgMonthlyPct)),
    row("Live forward (since first sync)", (p) => (p.liveForward.trades > 0 ? `${pct(p.liveForward.gainPct)} · ${p.liveForward.trades} trades` : "no trade yet")),
    row("Evidence of an edge", (p) => p.edgeLevel ?? "-"),
  ];
}

export const SUMMARY_DISCLAIMER =
  "Terminal-reported by each owner's own MetaTrader terminal, NOT independently verified. Percentages only. Past results do not predict future results; this is not investment advice. There is no ranking by gain on purpose.";
