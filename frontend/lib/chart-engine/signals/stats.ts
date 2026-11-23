// lib/chart-engine/signals/stats.ts
// Plain, honest summary of recorded signals: counts by outcome, the share that reached the target before the stop among FINISHED trades, the
// average R, and the share a break-even rule would need at the same reward:risk. Measured on the signals this platform actually generated
// (before spread and commission); a small n is flagged, nothing is extrapolated.
import { CLOSED_STATUSES, type SignalStatus } from "./outcome";

export interface SignalRow { status: SignalStatus; resultR: number | null; rr: number }

export interface SignalSummary {
  total: number;
  open: number;
  live: number;
  target: number;
  stop: number;
  expired: number;
  cancelled: number;
  unfilled: number;
  /** Finished trades = target + stop + expired. */
  closed: number;
  /** target / closed (null when nothing finished). */
  targetShare: number | null;
  avgR: number | null;
  /** Average of 1 / (1 + rr) over the finished trades: the target share needed just to break even at their reward:risk. */
  breakEvenShare: number | null;
  /** Below this many finished trades the numbers are too thin to say anything. */
  enoughData: boolean;
}

export const MIN_CLOSED_FOR_SUMMARY = 30;

export function summarize(rows: readonly SignalRow[]): SignalSummary {
  const count = (s: SignalStatus) => rows.filter((r) => r.status === s).length;
  const finished = rows.filter((r) => CLOSED_STATUSES.includes(r.status) && r.resultR !== null);
  const closed = finished.length;
  const sumR = finished.reduce((a, r) => a + (r.resultR as number), 0);
  const be = finished.reduce((a, r) => a + 1 / (1 + r.rr), 0);
  return {
    total: rows.length,
    open: count("open"),
    live: count("live"),
    target: count("target"),
    stop: count("stop"),
    expired: count("expired"),
    cancelled: count("cancelled"),
    unfilled: count("unfilled"),
    closed,
    targetShare: closed > 0 ? count("target") / closed : null,
    avgR: closed > 0 ? sumR / closed : null,
    breakEvenShare: closed > 0 ? be / closed : null,
    enoughData: closed >= MIN_CLOSED_FOR_SUMMARY,
  };
}
