// services/edge-analyzer/analysis/patterns.ts
// AT24 Trader Edge Analyzer (E1) - where/when/how the trader's results come from.
// Pure and deterministic. These are DESCRIPTIVE breakdowns with their sample
// sizes; nothing here asserts causation, and small buckets are flagged
// `lowSample` so the UI/report can say "too few trades to read into".

import type { ClosedTrade } from "../types";
import { sortByCloseTime } from "./core";

export const LOW_SAMPLE_THRESHOLD = 10;

export interface BucketStat {
  key: string;
  count: number;
  net: number;
  winRatePct: number;
  /** Average net per trade in this bucket. */
  expectancy: number;
  lowSample: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function bucketBy(trades: readonly ClosedTrade[], keyOf: (t: ClosedTrade) => string): BucketStat[] {
  const m = new Map<string, { count: number; net: number; wins: number }>();
  for (const t of trades) {
    const k = keyOf(t);
    const b = m.get(k) ?? { count: 0, net: 0, wins: 0 };
    b.count += 1;
    b.net += t.net;
    if (t.profit > 0) b.wins += 1;
    m.set(k, b);
  }
  return [...m.entries()]
    .map(([key, b]) => ({
      key,
      count: b.count,
      net: r2(b.net),
      winRatePct: r2((b.wins / b.count) * 100),
      expectancy: r2(b.net / b.count),
      lowSample: b.count < LOW_SAMPLE_THRESHOLD,
    }))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/** Max distinct tag rows before the rest are folded into one "other" row. */
export const MAX_TAG_ROWS = 20;
export const BROKER_COMMENT_KEY = "(broker auto comment)";
export const OTHER_TAGS_KEY = "(other tags)";

/** Broker-generated comments ("[sl 4213.4]", "[tp 4870.5]", "[p=159014]", "{1018195875}") are unique per trade, not a strategy. */
const BROKER_COMMENT = /^(\[(sl|tp|p=)[^\]]*\]|\{\d+\})$/i;

export function normalizeTag(tag: string): string {
  const t = tag.trim();
  if (!t) return "(none)";
  return BROKER_COMMENT.test(t) ? BROKER_COMMENT_KEY : t;
}

/** Tag buckets with broker comments grouped and the long tail folded into "(other tags)" (top rows by trade count). */
export function tagKeyer(trades: readonly ClosedTrade[], maxRows = MAX_TAG_ROWS): (t: ClosedTrade) => string {
  const counts = new Map<string, number>();
  for (const t of trades) counts.set(normalizeTag(t.tag), (counts.get(normalizeTag(t.tag)) ?? 0) + 1);
  const keep = new Set(
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxRows).map(([k]) => k),
  );
  return (t) => {
    const k = normalizeTag(t.tag);
    return keep.has(k) ? k : OTHER_TAGS_KEY;
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface SizeAfterOutcome {
  /** Average volume of a trade OPENED right after the previous trade (by close order) was a loss / a win. */
  avgVolumeAfterLoss: number | null;
  avgVolumeAfterWin: number | null;
  countAfterLoss: number;
  countAfterWin: number;
  /** avgVolumeAfterLoss / avgVolumeAfterWin; null if undefined. */
  ratio: number | null;
}

/** Volume of each trade vs the outcome of the trade that closed immediately before it opened. */
export function sizeAfterOutcome(trades: readonly ClosedTrade[]): SizeAfterOutcome {
  const ordered = sortByCloseTime(trades);
  const byOpen = [...trades].sort((a, b) => a.openTime - b.openTime);
  let ci = 0;
  let lastClosed: ClosedTrade | null = null;
  let lossVol = 0, lossN = 0, winVol = 0, winN = 0;
  for (const t of byOpen) {
    while (ci < ordered.length && ordered[ci]!.closeTime <= t.openTime) {
      lastClosed = ordered[ci]!;
      ci += 1;
    }
    if (!lastClosed) continue;
    if (lastClosed.profit < 0) { lossVol += t.volume; lossN += 1; }
    else if (lastClosed.profit > 0) { winVol += t.volume; winN += 1; }
  }
  const avgL = lossN > 0 ? lossVol / lossN : null;
  const avgW = winN > 0 ? winVol / winN : null;
  return {
    avgVolumeAfterLoss: avgL === null ? null : Math.round(avgL * 1000) / 1000,
    avgVolumeAfterWin: avgW === null ? null : Math.round(avgW * 1000) / 1000,
    countAfterLoss: lossN,
    countAfterWin: winN,
    ratio: avgL !== null && avgW !== null && avgW > 0 ? Math.round((avgL / avgW) * 1000) / 1000 : null,
  };
}

export interface Patterns {
  byHour: BucketStat[];
  byWeekday: BucketStat[];
  bySymbol: BucketStat[];
  byDirection: BucketStat[];
  /** By platform comment (often an EA/strategy tag). Empty-tag trades are grouped as "(none)". */
  byTag: BucketStat[];
  byHoldTime: BucketStat[];
  sizeAfterOutcome: SizeAfterOutcome;
}

const HOLD_BUCKETS: { key: string; max: number }[] = [
  { key: "1 under 1 min", max: 60_000 },
  { key: "2 1-5 min", max: 300_000 },
  { key: "3 5-30 min", max: 1_800_000 },
  { key: "4 30 min-4 h", max: 14_400_000 },
  { key: "5 over 4 h", max: Number.POSITIVE_INFINITY },
];

export function computePatterns(trades: readonly ClosedTrade[]): Patterns {
  const hourKey = (t: ClosedTrade) => String(new Date(t.openTime).getUTCHours()).padStart(2, "0");
  const dayKey = (t: ClosedTrade) => `${new Date(t.openTime).getUTCDay()} ${WEEKDAYS[new Date(t.openTime).getUTCDay()]}`;
  const holdKey = (t: ClosedTrade) => {
    const d = t.closeTime - t.openTime;
    return HOLD_BUCKETS.find((b) => d < b.max)!.key;
  };
  return {
    byHour: bucketBy(trades, hourKey),
    byWeekday: bucketBy(trades, dayKey),
    bySymbol: bucketBy(trades, (t) => t.symbol),
    byDirection: bucketBy(trades, (t) => t.direction),
    byTag: bucketBy(trades, tagKeyer(trades)),
    byHoldTime: bucketBy(trades, holdKey),
    sizeAfterOutcome: sizeAfterOutcome(trades),
  };
}
