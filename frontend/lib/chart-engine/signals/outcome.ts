// lib/chart-engine/signals/outcome.ts
// What became of a recorded Pro Chart signal, decided ONLY from the candles that came after it (no look-ahead, no judgement). Same rules as the
// plan's own measured record (plan.ts measurePlanRecord): a limit entry must be reached within PLAN_FILL_WINDOW bars (and is cancelled when price
// goes through the stop first); once live, the stop is checked first when both are hit inside one bar; the target is not credited on the bar a limit
// order fills; after PLAN_MAX_HOLD bars an open trade is marked to market. Spread and commission are NOT included.
import { PLAN_FILL_WINDOW, PLAN_MAX_HOLD } from "../annotations/plan";

export interface SignalForOutcome {
  dir: "long" | "short";
  entryType: "market" | "limit";
  entry: number;
  stop: number;
  target: number;
  rr: number;
  /** Open time (ms) of the last candle that existed when the signal was generated. Only candles AFTER it are used. */
  signalTime: number;
}

export type SignalStatus =
  | "open" //      limit order waiting for price to reach the entry (or a market signal waiting for its first candle)
  | "live" //      filled, neither stop nor target reached yet
  | "target" //    the target was reached first
  | "stop" //      the stop was reached first
  | "expired" //   held for PLAN_MAX_HOLD bars without either: closed at the market (result is the mark-to-market R)
  | "cancelled" // a limit signal: price went through the stop before the entry was reached
  | "unfilled"; // a limit signal: the entry was never reached within PLAN_FILL_WINDOW bars

export interface CandleLite { time: number; high: number; low: number; close: number }

export interface Outcome {
  status: SignalStatus;
  filledAt: number | null;
  closedAt: number | null;
  /** R multiple of a finished trade (stop = -1, target = +rr, expired = mark to market); null while unresolved or when no trade happened. */
  resultR: number | null;
  /** Time of the last candle that was looked at (so the next run can see how far the signal has been followed). */
  resolvedThrough: number | null;
}

export const CLOSED_STATUSES: readonly SignalStatus[] = ["target", "stop", "expired"];
export const NO_TRADE_STATUSES: readonly SignalStatus[] = ["cancelled", "unfilled"];
export const isFinished = (s: SignalStatus) => CLOSED_STATUSES.includes(s) || NO_TRADE_STATUSES.includes(s);

export function resolveOutcome(sig: SignalForOutcome, all: readonly CandleLite[]): Outcome {
  const candles = all.filter((c) => c.time > sig.signalTime).sort((a, b) => a.time - b.time);
  const resolvedThrough = candles.length > 0 ? candles[candles.length - 1].time : null;
  const long = sig.dir === "long";
  const risk = Math.abs(sig.entry - sig.stop);
  if (!(risk > 0) || candles.length === 0) return { status: "open", filledAt: null, closedAt: null, resultR: null, resolvedThrough };

  let start = 0;
  let filledAt: number | null = null;
  if (sig.entryType === "limit") {
    let filledIdx = -1;
    for (let j = 0; j < Math.min(candles.length, PLAN_FILL_WINDOW); j++) {
      const c = candles[j];
      if (long ? c.low <= sig.stop : c.high >= sig.stop) return { status: "cancelled", filledAt: null, closedAt: c.time, resultR: null, resolvedThrough };
      if (long ? c.low <= sig.entry : c.high >= sig.entry) { filledIdx = j; break; }
    }
    if (filledIdx < 0) {
      return candles.length >= PLAN_FILL_WINDOW
        ? { status: "unfilled", filledAt: null, closedAt: candles[PLAN_FILL_WINDOW - 1].time, resultR: null, resolvedThrough }
        : { status: "open", filledAt: null, closedAt: null, resultR: null, resolvedThrough };
    }
    start = filledIdx;
    filledAt = candles[filledIdx].time;
  } else {
    filledAt = candles[0].time;
  }

  for (let j = start; j < Math.min(candles.length, start + PLAN_MAX_HOLD); j++) {
    const c = candles[j];
    const stopHit = long ? c.low <= sig.stop : c.high >= sig.stop;
    const targetHit = !(sig.entryType === "limit" && j === start) && (long ? c.high >= sig.target : c.low <= sig.target);
    if (stopHit) return { status: "stop", filledAt, closedAt: c.time, resultR: -1, resolvedThrough };
    if (targetHit) return { status: "target", filledAt, closedAt: c.time, resultR: sig.rr, resolvedThrough };
  }
  if (candles.length > start + PLAN_MAX_HOLD) {
    const last = candles[start + PLAN_MAX_HOLD];
    const r = ((long ? last.close - sig.entry : sig.entry - last.close) / risk);
    return { status: "expired", filledAt, closedAt: last.time, resultR: r, resolvedThrough };
  }
  return { status: "live", filledAt, closedAt: null, resultR: null, resolvedThrough };
}
