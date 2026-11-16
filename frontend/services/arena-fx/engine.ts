// services/arena-fx/engine.ts
// Pure maths of the AI Arena (forex, gold, energy, indices): positions, scoring, the luck band and the verdict. No network, no database.
//
// RULES, fixed before any result existed (2026-11-17):
//  - Once per weekday at decision time a snapshot of every open market is taken (price, daily ATR %, map alignment). Every contestant sets a position
//    for each market from that snapshot only: +1 long, -1 short, 0 flat. The position is held until the market's NEXT snapshot.
//  - Return of one position = (next price / price - 1) * 100 / ATR%  (daily ATR units), times the position, minus COST_ATR for every change of position
//    (a flip counts twice). COST_ATR is an assumption (round-trip spread and slippage), not a measurement: 0.03 of a daily ATR.
//  - A contestant's day = the average over the markets that day; its equity = the running sum of days.
//  - Decoys: 200 random contestants (position -1, 0, +1 with equal probability from a seeded hash of seed, day and market). They show what luck alone does.
//    A contestant's rank = the share of decoys it beat on total result.
//  - Verdict: under 20 scored days COLLECTING; from 30 days: rank >= 97.5 = AHEAD OF LUCK ON THIS HISTORY, rank <= 2.5 = BEHIND LUCK, else INSIDE THE LUCK BAND.
// Limits stated with the numbers: paper only (no real fills, no swap), one daily decision, a short history proves little, and 200 decoys give a rank in steps of 0.5.
import type { SwingAlignment } from "@/types/swing-lab";

export const COST_ATR = 0.03;
export const DECOY_COUNT = 200;
export const MIN_DAYS_SHOWN = 20;
export const MIN_DAYS_VERDICT = 30;
export const RANK_HIGH = 97.5;
export const RANK_LOW = 2.5;

export type Pos = -1 | 0 | 1;

export interface SnapRow {
  dayKey: string;
  symbol: string;
  price: number;
  atrPct: number;
  alignment: SwingAlignment;
}

/** FNV-1a hash of a string to a unit interval [0, 1). */
export function hashUnit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // one more mixing round so near-equal inputs do not give near-equal outputs
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function decoyPosition(seed: number, dayKey: string, symbol: string): Pos {
  const u = hashUnit(`${seed}|${dayKey}|${symbol}`);
  return u < 1 / 3 ? -1 : u < 2 / 3 ? 0 : 1;
}

/** The rule contestant: follow the alignment of the map. */
export function trendPosition(alignment: SwingAlignment): Pos {
  return alignment === "aligned up" ? 1 : alignment === "aligned down" ? -1 : 0;
}

export type PositionOf = (s: SnapRow) => Pos;

export interface DayScore {
  dayKey: string;
  pnl: number;
}

/** For each symbol: snapshots in day order; the raw move to the next snapshot in daily ATR units (null for the last one). */
export function rawMoves(snaps: ReadonlyArray<SnapRow>): Map<string, number | null> {
  const bySymbol = new Map<string, SnapRow[]>();
  for (const s of snaps) bySymbol.set(s.symbol, [...(bySymbol.get(s.symbol) ?? []), s]);
  const out = new Map<string, number | null>();
  for (const list of bySymbol.values()) {
    list.sort((a, b) => (a.dayKey < b.dayKey ? -1 : 1));
    for (let i = 0; i < list.length; i++) {
      const next = list[i + 1];
      out.set(`${list[i].dayKey}|${list[i].symbol}`, next ? (100 * (next.price / list[i].price - 1)) / list[i].atrPct : null);
    }
  }
  return out;
}

/** Days scored for one contestant, oldest first. A day appears only when at least one market on it has a next snapshot. */
export function scoreDays(snaps: ReadonlyArray<SnapRow>, raws: ReadonlyMap<string, number | null>, positionOf: PositionOf): DayScore[] {
  const sorted = [...snaps].sort((a, b) => (a.dayKey === b.dayKey ? (a.symbol < b.symbol ? -1 : 1) : a.dayKey < b.dayKey ? -1 : 1));
  const prev = new Map<string, Pos>();
  const sums = new Map<string, { sum: number; n: number }>();
  for (const s of sorted) {
    const pos = positionOf(s);
    const before = prev.get(s.symbol) ?? 0;
    prev.set(s.symbol, pos);
    const raw = raws.get(`${s.dayKey}|${s.symbol}`);
    if (raw === null || raw === undefined) continue;
    const pnl = pos * raw - COST_ATR * Math.abs(pos - before);
    const cur = sums.get(s.dayKey) ?? { sum: 0, n: 0 };
    cur.sum += pnl;
    cur.n += 1;
    sums.set(s.dayKey, cur);
  }
  return [...sums.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([dayKey, v]) => ({ dayKey, pnl: v.sum / v.n }));
}

export function cumulative(days: ReadonlyArray<DayScore>): number[] {
  const out: number[] = [];
  let c = 0;
  for (const d of days) {
    c += d.pnl;
    out.push(c);
  }
  return out;
}

export type ArenaVerdict = "COLLECTING" | "AHEAD OF LUCK ON THIS HISTORY" | "BEHIND LUCK ON THIS HISTORY" | "INSIDE THE LUCK BAND";

export function verdictOf(days: number, rankPct: number | null): ArenaVerdict {
  if (days < MIN_DAYS_VERDICT || rankPct === null) return "COLLECTING";
  return rankPct >= RANK_HIGH ? "AHEAD OF LUCK ON THIS HISTORY" : rankPct <= RANK_LOW ? "BEHIND LUCK ON THIS HISTORY" : "INSIDE THE LUCK BAND";
}

/** Share of the decoys (percent) whose total is below `total`; a tie counts half. */
export function rankAmong(total: number, decoyTotals: ReadonlyArray<number>): number | null {
  if (decoyTotals.length === 0) return null;
  let below = 0;
  for (const d of decoyTotals) below += d < total ? 1 : d === total ? 0.5 : 0;
  return (100 * below) / decoyTotals.length;
}

export function percentile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface ContestantInput {
  id: string;
  label: string;
  kind: "ai" | "rule";
  positionOf: PositionOf;
  /** Days this contestant took part in (an AI contestant only counts from its first run). Undefined = every snapshot day. */
  activeDays?: ReadonlySet<string>;
}

export interface ContestantResult {
  id: string;
  label: string;
  kind: "ai" | "rule";
  days: number;
  total: number;
  meanPerDay: number | null;
  hitDaysPct: number | null;
  /** Rank among the decoys over the SAME days. Null while fewer than MIN_DAYS_SHOWN days. */
  rankPct: number | null;
  verdict: ArenaVerdict;
  /** Running equity per global day (ATR units), null before the contestant's first scored day. */
  cum: Array<number | null>;
}

export interface ArenaBoard {
  dayKeys: string[];
  contestants: ContestantResult[];
  /** Decoy band per day (running equity, ATR units). */
  band: { p5: number[]; p50: number[]; p95: number[] };
  decoys: number;
  costAtr: number;
  snapshotDays: number;
  markets: number;
}

export function buildArena(snaps: ReadonlyArray<SnapRow>, contestants: ReadonlyArray<ContestantInput>, decoyCount = DECOY_COUNT): ArenaBoard {
  const raws = rawMoves(snaps);
  const snapshotDays = new Set(snaps.map((s) => s.dayKey)).size;
  const markets = new Set(snaps.map((s) => s.symbol)).size;
  const decoyDays: DayScore[][] = [];
  let dayKeys: string[] = [];
  for (let seed = 1; seed <= decoyCount; seed++) {
    const days = scoreDays(snaps, raws, (s) => decoyPosition(seed, s.dayKey, s.symbol));
    if (days.length > dayKeys.length) dayKeys = days.map((d) => d.dayKey);
    decoyDays.push(days);
  }
  const band = { p5: [] as number[], p50: [] as number[], p95: [] as number[] };
  const decoyCums = decoyDays.map((d) => cumulative(d));
  for (let d = 0; d < dayKeys.length; d++) {
    const col = decoyCums.map((c) => c[d] ?? c[c.length - 1] ?? 0).sort((a, b) => a - b);
    band.p5.push(percentile(col, 0.05));
    band.p50.push(percentile(col, 0.5));
    band.p95.push(percentile(col, 0.95));
  }
  const results: ContestantResult[] = contestants.map((c) => {
    const own = c.activeDays ? snaps.filter((s) => c.activeDays!.has(s.dayKey)) : snaps;
    const days = scoreDays(own, raws, c.positionOf);
    const mine = new Set(days.map((d) => d.dayKey));
    const total = days.reduce((sum, d) => sum + d.pnl, 0);
    const decoyTotals = decoyDays.map((ds) => ds.reduce((sum, d) => sum + (mine.has(d.dayKey) ? d.pnl : 0), 0));
    const rankPct = days.length >= MIN_DAYS_SHOWN ? rankAmong(total, decoyTotals) : null;
    const byDay = new Map(days.map((d) => [d.dayKey, d.pnl]));
    let run = 0;
    let started = false;
    const cum = dayKeys.map((k) => {
      if (byDay.has(k)) {
        run += byDay.get(k) as number;
        started = true;
      }
      return started ? run : null;
    });
    return {
      id: c.id,
      label: c.label,
      kind: c.kind,
      days: days.length,
      total,
      meanPerDay: days.length ? total / days.length : null,
      hitDaysPct: days.length ? (100 * days.filter((d) => d.pnl > 0).length) / days.length : null,
      rankPct,
      verdict: verdictOf(days.length, rankPct),
      cum,
    };
  });
  return { dayKeys, contestants: results, band, decoys: decoyCount, costAtr: COST_ATR, snapshotDays, markets };
}
