// services/swing-lab/scoreboard.ts
// Pure maths for the Swing Lab forward scoreboard (no network, no database; the validation script imports it).
//
// RULES, fixed before any result existed (2026-11-16):
//  - Once per UTC day and market, the first time the market is open (its last closed 4-hour bar is under 8 hours old), the map state is
//    recorded: the weekly / daily / 4-hour alignment, the price (the close of that 4-hour bar) and the daily ATR as percent of price.
//  - The snapshot is scored 120 hours (5 days) after the price time: the close of the last closed 4-hour bar at or before that moment
//    (a Friday close when the target falls on a weekend). If that bar is more than 72 hours older than the target the snapshot is dropped.
//  - raw = (forward price / price - 1) * 100 / ATR%   (the move in daily ATR units).
//    r = raw for "aligned up", -raw for "aligned down" (continuation of the alignment), none for "mixed".
//  - Touches of the same market and direction that start less than 5 days after an already counted one are dropped (no move counted twice).
//  - Verdict per market and direction, per group and pooled: fewer than 30 counted events = COLLECTING; otherwise t = mean / (sd / sqrt(n)),
//    |t| >= 2.58 = POSITIVE or NEGATIVE ON THIS HISTORY, else NO EDGE SHOWN.
// Limits stated with the numbers: in a rising market "aligned up" gets a free ride and "aligned down" is penalised, so the average
// raw move of all snapshots (the drift) is shown next to the results; markets move together (dollar), so the pooled t is optimistic.
import { MIN_EVENTS, T_THRESHOLD, scoreEvents, type ScoreRow } from "@/services/crypto-flow/scoreboard";
import { getSwingInstrument, type SwingAlignment, type SwingGroup } from "@/types/swing-lab";
import type { Bar } from "./compute";

export { MIN_EVENTS, T_THRESHOLD };

export const BAR_4H_MS = 4 * 3_600_000;
export const FORWARD_MS = 120 * 3_600_000;
export const MAX_GAP_MS = 72 * 3_600_000;
export const OPEN_MAX_AGE_MS = 8 * 3_600_000;
export const DEDUPE_MS = 5 * 86_400_000;

export type SwingDir = "up" | "down";

/** True when the last closed 4-hour bar is recent enough for the market to count as open. */
export function marketOpen(lastBarOpenMs: number, nowMs: number): boolean {
  return nowMs - lastBarOpenMs <= OPEN_MAX_AGE_MS;
}

/** Close of the last closed 4-hour bar at or before `targetMs` (bars oldest first, bar close = open + 4 h). Null when there is none or it is too old. */
export function forwardClose(bars: ReadonlyArray<Bar>, targetMs: number): number | null {
  let best: Bar | null = null;
  for (const b of bars) {
    if (b.t + BAR_4H_MS <= targetMs) best = b;
    else break;
  }
  if (!best) return null;
  return targetMs - (best.t + BAR_4H_MS) > MAX_GAP_MS ? null : best.close;
}

export interface Snapshot {
  alignment: SwingAlignment;
  price: number;
  atrPct: number;
}

export function scoreSnapshot(s: Snapshot, fwdPrice: number): { rawAtr: number; r: number | null } {
  const raw = (100 * (fwdPrice / s.price - 1)) / s.atrPct;
  return { rawAtr: raw, r: s.alignment === "aligned up" ? raw : s.alignment === "aligned down" ? -raw : null };
}

export interface DoneSnapshot {
  symbol: string;
  alignment: SwingAlignment;
  /** Price time (bar open + 4 h) in epoch ms. */
  at: number;
  rawAtr: number;
  r: number | null;
}

export interface SwingEvent {
  symbol: string;
  dir: SwingDir;
  at: number;
  r: number;
}

export function dedupeSwingEvents(events: ReadonlyArray<SwingEvent>): SwingEvent[] {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const last = new Map<string, number>();
  const out: SwingEvent[] = [];
  for (const e of sorted) {
    const key = `${e.symbol}|${e.dir}`;
    const prev = last.get(key);
    if (prev !== undefined && e.at - prev < DEDUPE_MS) continue;
    last.set(key, e.at);
    out.push(e);
  }
  return out;
}

export interface SwingBoardRow extends ScoreRow {
  /** Average raw move (daily ATR units) of ALL scored snapshots of this scope, any alignment: the drift the aligned results have to beat. */
  driftAtr: number | null;
  snapshots: number;
}

export interface SwingBoard {
  pooled: { up: SwingBoardRow; down: SwingBoardRow };
  groups: Array<{ group: SwingGroup; up: SwingBoardRow; down: SwingBoardRow }>;
  rows: Array<{ symbol: string; up: SwingBoardRow; down: SwingBoardRow }>;
  open: number;
  done: number;
}

function row(events: ReadonlyArray<SwingEvent>, dir: SwingDir, raws: ReadonlyArray<number>): SwingBoardRow {
  const score = scoreEvents(events.filter((e) => e.dir === dir).map((e) => e.r));
  return { ...score, driftAtr: raws.length > 0 ? raws.reduce((s, v) => s + v, 0) / raws.length : null, snapshots: raws.length };
}

export function buildSwingBoard(done: ReadonlyArray<DoneSnapshot>, open: number): SwingBoard {
  const events: SwingEvent[] = [];
  for (const d of done) {
    if (d.r === null) continue;
    events.push({ symbol: d.symbol, dir: d.alignment === "aligned up" ? "up" : "down", at: d.at, r: d.r });
  }
  const kept = dedupeSwingEvents(events);
  const groupOf = (symbol: string): SwingGroup | undefined => getSwingInstrument(symbol)?.group;
  const symbols = [...new Set(done.map((d) => d.symbol))].sort();
  const groups: SwingGroup[] = ["forex", "metals", "energy", "indices"];
  return {
    pooled: { up: row(kept, "up", done.map((d) => d.rawAtr)), down: row(kept, "down", done.map((d) => d.rawAtr)) },
    groups: groups
      .map((g) => {
        const ke = kept.filter((e) => groupOf(e.symbol) === g);
        const raws = done.filter((d) => groupOf(d.symbol) === g).map((d) => d.rawAtr);
        return { group: g, up: row(ke, "up", raws), down: row(ke, "down", raws) };
      })
      .filter((g) => g.up.snapshots > 0),
    rows: symbols.map((symbol) => {
      const ke = kept.filter((e) => e.symbol === symbol);
      const raws = done.filter((d) => d.symbol === symbol).map((d) => d.rawAtr);
      return { symbol, up: row(ke, "up", raws), down: row(ke, "down", raws) };
    }),
    open,
    done: done.length,
  };
}
