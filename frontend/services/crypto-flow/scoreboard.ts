// services/crypto-flow/scoreboard.ts
// Pure maths for the Flow Zones forward scoreboard (no network, no database, so the validation script can import it).
//
// RULES, fixed before any result existed (2026-11-14):
//  - Once an hour, per instrument, the 24-hour zones are recorded (buyer zone, seller zone, price, step) from the 5-minute bars.
//  - A zone is TOUCHED by the first 5-minute bar after the snapshot (within the next 72 bars = 6 hours) that reaches it:
//      buyer zone:  bar.low  <= zone + step / 2        seller zone: bar.high >= zone - step / 2     (step = price * stepPct / 100)
//  - The reaction is measured from the CLOSE of the touch bar to the close 12 bars (1 hour) later, in the zone's favourable direction
//    (buyer zone: up, seller zone: down), in units of X = the instrument's typical one-hour range (median over the last 24 hours,
//    percent of price):  r = direction * (close[k + 12] / close[k] - 1) * 100 / X.
//  - Touches of the same instrument and side that start less than 12 bars after an already counted touch are dropped, so no hour of
//    price movement is counted twice.
//  - Verdict per instrument and side, and for all instruments pooled: fewer than 30 counted touches = COLLECTING; otherwise the
//    mean r with t = mean / (sd / sqrt(n)); |t| >= 2.58 (about 1 % two-sided) = POSITIVE or NEGATIVE ON THIS HISTORY; else NO EDGE SHOWN.
// Limits stated with the numbers: a rising market lifts buyer-zone results and lowers seller-zone results with no help from the zone;
// the pooled row mixes instruments that move together, so its t is optimistic.
import type { ZoneBar } from "./zones";

export const WATCH_BARS = 72;
export const REACT_BARS = 12;
export const MIN_EVENTS = 30;
export const T_THRESHOLD = 2.58;

export type ZoneSide = "buyer" | "seller";

/** Typical one-hour range: median of (high - low) / last close over 12-bar chunks, taken from the end of the series. Percent. */
export function typicalHourRangePct(bars: ReadonlyArray<ZoneBar>): number | null {
  const ranges: number[] = [];
  for (let end = bars.length; end - 12 >= 0 && ranges.length < 24; end -= 12) {
    const chunk = bars.slice(end - 12, end);
    const hi = Math.max(...chunk.map((b) => b.high));
    const lo = Math.min(...chunk.map((b) => b.low));
    const close = chunk[chunk.length - 1].close;
    if (close > 0) ranges.push((100 * (hi - lo)) / close);
  }
  if (ranges.length < 6) return null;
  ranges.sort((a, b) => a - b);
  const m = ranges.length >> 1;
  return ranges.length % 2 ? ranges[m] : (ranges[m - 1] + ranges[m]) / 2;
}

export interface SnapshotZones {
  price: number;
  stepPct: number;
  xRangePct: number;
  buyerPrice: number | null;
  sellerPrice: number | null;
}

export interface SideOutcome {
  /** Open time of the touch bar, epoch ms. Null when the zone was not reached within the watch window. */
  touchAt: number | null;
  /** Reaction in units of X; null when not touched. */
  r: number | null;
}

export type Evaluation =
  | { state: "pending" }
  | { state: "done"; buyer: SideOutcome; seller: SideOutcome };

/** Index of the first bar that reaches the zone of `side`, or -1. */
export function firstTouchIndex(side: ZoneSide, s: SnapshotZones, bars: ReadonlyArray<ZoneBar>): number {
  const zone = side === "buyer" ? s.buyerPrice : s.sellerPrice;
  if (zone === null) return -1;
  const step = (s.price * s.stepPct) / 100;
  for (let i = 0; i < bars.length; i++) {
    const hit = side === "buyer" ? bars[i].low <= zone + step / 2 : bars[i].high >= zone - step / 2;
    if (hit) return i;
  }
  return -1;
}

export const ALERT_COOLDOWN_MS = 3 * 3_600_000;
/** A touch older than this when the sweep notices it is recorded but not sent (it would be stale news). */
export const ALERT_FRESH_MS = 30 * 60_000;

/** Whether a touch should be sent to a member: new snapshot, cooldown over, touch recent. */
export function shouldAlert(a: { touchBarOpenMs: number; nowMs: number; obsId: string; lastObsId: string | null; lastAtMs: number | null }): boolean {
  if (a.lastObsId === a.obsId) return false;
  if (a.lastAtMs !== null && a.nowMs - a.lastAtMs < ALERT_COOLDOWN_MS) return false;
  return a.nowMs - (a.touchBarOpenMs + 5 * 60_000) <= ALERT_FRESH_MS;
}

/**
 * Scores one snapshot against the bars that followed it (oldest first, all closed, the first bar opens right after the snapshot bar).
 * "pending" until the watch window plus the reaction window are fully available, or the touch plus its reaction window is.
 */
export function evaluateSnapshot(s: SnapshotZones, after: ReadonlyArray<ZoneBar>): Evaluation {
  const watch = after.slice(0, WATCH_BARS);
  const sideResult = (side: ZoneSide): SideOutcome | "pending" => {
    if ((side === "buyer" ? s.buyerPrice : s.sellerPrice) === null) return { touchAt: null, r: null };
    const k = firstTouchIndex(side, s, watch);
    if (k < 0) return watch.length >= WATCH_BARS ? { touchAt: null, r: null } : "pending";
    const end = after[k + REACT_BARS];
    if (!end) return "pending";
    const dir = side === "buyer" ? 1 : -1;
    const ret = (100 * dir * (end.close / after[k].close - 1)) / s.xRangePct;
    return { touchAt: after[k].t, r: ret };
  };
  const buyer = sideResult("buyer");
  const seller = sideResult("seller");
  if (buyer === "pending" || seller === "pending") return { state: "pending" };
  return { state: "done", buyer, seller };
}

export interface ScoredEvent {
  symbol: string;
  side: ZoneSide;
  touchAt: number;
  r: number;
}

/** Drops touches that start less than REACT_BARS bars (60 minutes) after an already counted touch of the same symbol and side. */
export function dedupeEvents(events: ReadonlyArray<ScoredEvent>): ScoredEvent[] {
  const sorted = [...events].sort((a, b) => a.touchAt - b.touchAt);
  const lastKept = new Map<string, number>();
  const out: ScoredEvent[] = [];
  for (const e of sorted) {
    const key = `${e.symbol}|${e.side}`;
    const prev = lastKept.get(key);
    if (prev !== undefined && e.touchAt - prev < REACT_BARS * 5 * 60_000) continue;
    lastKept.set(key, e.touchAt);
    out.push(e);
  }
  return out;
}

export type ScoreVerdict = "COLLECTING" | "POSITIVE ON THIS HISTORY" | "NEGATIVE ON THIS HISTORY" | "NO EDGE SHOWN";

export interface ScoreRow {
  n: number;
  meanR: number | null;
  /** Share of events with r > 0, percent. */
  hitPct: number | null;
  t: number | null;
  verdict: ScoreVerdict;
}

export function scoreEvents(rs: ReadonlyArray<number>): ScoreRow {
  const n = rs.length;
  if (n === 0) return { n: 0, meanR: null, hitPct: null, t: null, verdict: "COLLECTING" };
  const mean = rs.reduce((s, v) => s + v, 0) / n;
  const hit = (100 * rs.filter((v) => v > 0).length) / n;
  let t: number | null = null;
  if (n >= 2) {
    const sd = Math.sqrt(rs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1));
    t = sd > 0 ? mean / (sd / Math.sqrt(n)) : null;
  }
  let verdict: ScoreVerdict = "COLLECTING";
  if (n >= MIN_EVENTS) verdict = t !== null && t >= T_THRESHOLD ? "POSITIVE ON THIS HISTORY" : t !== null && t <= -T_THRESHOLD ? "NEGATIVE ON THIS HISTORY" : "NO EDGE SHOWN";
  return { n, meanR: mean, hitPct: hit, t, verdict };
}

export interface ScoreboardResult {
  /** One row per symbol and side. */
  rows: Array<{ symbol: string; side: ZoneSide } & ScoreRow & { untouched: number }>;
  pooled: { buyer: ScoreRow; seller: ScoreRow };
  /** Snapshots still waiting for their watch window, and snapshots scored. */
  open: number;
  done: number;
}

/** Builds the scoreboard from scored touches and the count of snapshots whose zone was never reached. */
export function buildScoreboard(events: ReadonlyArray<ScoredEvent>, untouched: ReadonlyArray<{ symbol: string; side: ZoneSide }>, open: number, done: number): ScoreboardResult {
  const kept = dedupeEvents(events);
  const keys = new Set<string>();
  for (const e of kept) keys.add(`${e.symbol}|${e.side}`);
  for (const u of untouched) keys.add(`${u.symbol}|${u.side}`);
  const rows = [...keys].sort().map((key) => {
    const [symbol, side] = key.split("|") as [string, ZoneSide];
    const rs = kept.filter((e) => e.symbol === symbol && e.side === side).map((e) => e.r);
    return { symbol, side, ...scoreEvents(rs), untouched: untouched.filter((u) => u.symbol === symbol && u.side === side).length };
  });
  return {
    rows,
    pooled: {
      buyer: scoreEvents(kept.filter((e) => e.side === "buyer").map((e) => e.r)),
      seller: scoreEvents(kept.filter((e) => e.side === "seller").map((e) => e.r)),
    },
    open,
    done,
  };
}
