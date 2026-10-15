// services/calibration/forecast.ts
// The calibration scoreboard's pure part. Every few hours the platform states a volatility range for each instrument
// ("about 80% of past moves stayed within +/-X over the next 12h / 24h"). Here that statement is recorded, and once the
// time has passed it is checked against what price actually did. The scoreboard then shows the honest hit rate.
// Direction is never forecast: a forecast is inside its band when |price later - price then| <= half-width.

import { rangesFor, type RangeEvent } from "@/services/smc/expected-range";

export const HORIZONS = [12, 24] as const;
export type Horizon = (typeof HORIZONS)[number];
export const TARGET_COVERAGE = 0.8;
/** Below this many settled forecasts the live rate is shown as "collecting", never as a verdict. */
export const MIN_SAMPLE = 30;
const HOUR = 3_600_000;
/** An outcome candle that is still missing this long after it was due (market closed, feed gap) voids that horizon. */
export const VOID_AFTER_MS = 6 * HOUR;
const SLOT_MS = 4 * HOUR;

export interface NewForecast {
  symbol: string;
  issuedAt: Date;
  price: number;
  atr: number;
  band12: number;
  band24: number;
  /** A validated scheduled US release (CPI, payrolls, Fed decision) falls inside this horizon's window, so the band was widened. */
  event12: boolean;
  event24: boolean;
}

/** The 4-hour slot an instant belongs to (00, 04, 08 ... UTC): one forecast per symbol per slot, so a re-run is idempotent. */
export const slotStart = (now: Date): Date => new Date(Math.floor(now.getTime() / SLOT_MS) * SLOT_MS);

export function buildForecast(symbol: string, a: { price: number; atr: number; lastClosedTime: string }, now: Date, events?: readonly RangeEvent[] | null): NewForecast | null {
  const r = rangesFor(a, { symbol, nowMs: now.getTime(), events });
  if (!r) return null;
  const { r12, r24 } = r;
  // A stale last candle means the market is closed (weekend, holiday): a forecast then would be "inside" trivially.
  const lastMs = new Date(a.lastClosedTime).getTime();
  if (!Number.isFinite(lastMs) || now.getTime() - lastMs > 2 * HOUR + 5 * 60_000) return null;
  return { symbol, issuedAt: slotStart(now), price: a.price, atr: a.atr, band12: r12.dist, band24: r24.dist, event12: r12.factor > 1, event24: r24.factor > 1 };
}

export interface StoredForecast {
  id: string;
  symbol: string;
  issuedAt: Date;
  price: number;
  band12: number;
  band24: number;
  settled12: boolean;
  settled24: boolean;
}

export interface Settlement {
  horizon: Horizon;
  /** null = voided (no outcome candle). */
  inside: boolean | null;
  priceLater: number | null;
}

/**
 * Decide what, if anything, can be settled for one forecast. `closeAt(hours)` returns the close of the hourly candle that
 * ENDS exactly `hours` after the issue slot, or null when there is none.
 */
export function settle(f: StoredForecast, now: Date, closeAt: (hoursAfterIssue: number) => number | null): Settlement[] {
  const out: Settlement[] = [];
  for (const h of HORIZONS) {
    if (h === 12 ? f.settled12 : f.settled24) continue;
    const dueMs = f.issuedAt.getTime() + h * HOUR;
    if (now.getTime() < dueMs + 5 * 60_000) continue; // not due yet (the candle needs a few minutes to be final)
    const close = closeAt(h);
    if (close === null) {
      if (now.getTime() - dueMs > VOID_AFTER_MS) out.push({ horizon: h, inside: null, priceLater: null });
      continue;
    }
    const band = h === 12 ? f.band12 : f.band24;
    out.push({ horizon: h, inside: Math.abs(close - f.price) <= band, priceLater: close });
  }
  return out;
}

/** Wilson score interval for a proportion (95%): honest about small samples. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}

export type CalibrationStatus = "collecting" | "on-target" | "above" | "below";

export interface CalibrationRow {
  symbol: string;
  horizon: Horizon;
  /** Forecasts settled with an outcome (voided ones are excluded). */
  n: number;
  inside: number;
  rate: number | null;
  lo: number | null;
  hi: number | null;
  /** "collecting" below MIN_SAMPLE; otherwise whether the 80% target sits inside the interval ("on-target") or the rate is clearly above / below it. */
  status: CalibrationStatus;
}

function row(symbol: string, horizon: Horizon, vals: boolean[]): CalibrationRow {
  const n = vals.length;
  const inside = vals.filter(Boolean).length;
  if (n === 0) return { symbol, horizon, n, inside, rate: null, lo: null, hi: null, status: "collecting" };
  const ci = wilson(inside, n);
  const status: CalibrationStatus = n < MIN_SAMPLE ? "collecting" : ci.lo > TARGET_COVERAGE ? "above" : ci.hi < TARGET_COVERAGE ? "below" : "on-target";
  return { symbol, horizon, n, inside, rate: inside / n, lo: ci.lo, hi: ci.hi, status };
}

type Outcome = { symbol: string; inside12: boolean | null; inside24: boolean | null };
const valuesFor = (rows: readonly Outcome[], h: Horizon): boolean[] => rows.map((r) => (h === 12 ? r.inside12 : r.inside24)).filter((v): v is boolean => v !== null);

export function summarise(rows: readonly Outcome[], symbols: readonly string[]): CalibrationRow[] {
  return symbols.flatMap((symbol) => HORIZONS.map((h) => row(symbol, h, valuesFor(rows.filter((r) => r.symbol === symbol), h))));
}

/** All instruments pooled, per horizon. */
export function pooled(rows: readonly Outcome[]): CalibrationRow[] {
  return HORIZONS.map((h) => row("ALL", h, valuesFor(rows, h)));
}

type OutcomeWithEvent = Outcome & { event12: boolean; event24: boolean };

/**
 * Pooled rows split by whether a validated scheduled release fell inside that horizon's window: the plain band should hold in
 * ordinary windows, and the widened one in release windows. Each horizon is split on its OWN flag.
 */
export function pooledByWindow(rows: readonly OutcomeWithEvent[]): { normal: CalibrationRow[]; event: CalibrationRow[] } {
  const pick = (h: Horizon, ev: boolean) => rows.filter((r) => (h === 12 ? r.event12 : r.event24) === ev).map((r) => (h === 12 ? r.inside12 : r.inside24)).filter((v): v is boolean => v !== null);
  return {
    normal: HORIZONS.map((h) => row("ALL", h, pick(h, false))),
    event: HORIZONS.map((h) => row("ALL", h, pick(h, true))),
  };
}
