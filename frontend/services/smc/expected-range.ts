// services/smc/expected-range.ts
// Pure helpers shared by the evidence line, Brief 2.0 and the market alerts: the validated "typical move size"
// band and the key-level summary. Direction is NOT forecast anywhere here - only the size of a move (volatility
// clusters; see docs/research/SMC_AND_VOLATILITY_RD.md) and where yesterday's / last week's extremes sit.

import type { SmcAnalysis } from "./smc-engine";

/** 80% band multipliers on ATR*sqrt(hours), fitted in-sample and verified out-of-sample on 3.7 years of Gold and Bitcoin. */
export const RANGE_MULT_80 = { 12: 0.9, 24: 0.95 } as const;

/** Price with a sensible number of decimals for any instrument (4170.05, 158.372, 1.11916). */
export function fmtPrice(p: number): string {
  const d = Math.abs(p) >= 1000 ? 2 : Math.abs(p) >= 100 ? 3 : 5;
  return p.toFixed(d);
}

/** A price distance with the precision of the instrument (11.98 on gold, 0.00123 on EURUSD). */
export const fmtDist = (d: number, price: number): string => d.toFixed(Math.abs(price) >= 100 ? 2 : 5);

export type RangeClass = "metals-fx" | "crypto";

/**
 * Widening of the band when a scheduled US release falls inside the window. Fitted on the 2023-24 sample and checked on 2025-26
 * (docs/research/SMC_AND_VOLATILITY_RD.md, section 8): without it the band covered only about 53% of 12h windows containing a
 * CPI / payrolls / Fed decision on Gold (about 83% on Bitcoin's 24h). Gold-class factors are also applied to silver and the
 * forex majors, which have NOT been tested separately - the live scoreboard checks every market on its own.
 */
export const EVENT_WIDEN: Record<RangeClass, Record<12 | 24, number>> = {
  "metals-fx": { 12: 2.0, 24: 1.4 },
  crypto: { 12: 1.3, 24: 1.0 },
};

export const rangeClassFor = (symbol: string): RangeClass => (/^(BTC|ETH|SOL|XRP)/i.test(symbol) ? "crypto" : "metals-fx");

export interface RangeEvent {
  title: string;
  currency: string;
  /** UTC ISO. */
  eventTime: string;
  impact?: string;
  isHoliday?: boolean;
  allDay?: boolean;
}

const EVENT_FAMILIES: ReadonlyArray<{ label: string; test: RegExp }> = [
  { label: "US CPI", test: /\bCPI\b/i },
  { label: "US payrolls", test: /non-?farm (employment change|payrolls)/i },
  { label: "Fed decision", test: /federal funds rate|FOMC statement/i },
];

/** The validated releases (US CPI, Non-Farm Payrolls, Fed rate decision) that fall between `nowMs` and `nowMs + hours`. Anything else is ignored: it was not tested. */
export function validatedEventsInWindow(events: readonly RangeEvent[] | null | undefined, nowMs: number, hours: number): Array<RangeEvent & { label: string; tsMs: number }> {
  if (!events) return [];
  const out: Array<RangeEvent & { label: string; tsMs: number }> = [];
  for (const e of events) {
    if (e.currency !== "USD" || e.isHoliday || e.allDay) continue;
    const tsMs = new Date(e.eventTime).getTime();
    if (!Number.isFinite(tsMs) || tsMs < nowMs || tsMs > nowMs + hours * 3_600_000) continue;
    const fam = EVENT_FAMILIES.find((f) => f.test.test(e.title));
    if (fam) out.push({ ...e, label: fam.label, tsMs });
  }
  return out.sort((a, b) => a.tsMs - b.tsMs);
}

export interface ExpectedRange {
  hours: 12 | 24;
  /** Half-width in price units (the move stays within +/- this about 80% of the time). */
  dist: number;
  pct: number;
  /** 1 = the plain volatility band; above 1 = widened for a scheduled release inside the window. */
  factor: number;
}

export function expectedRange(atr: number, price: number, hours: 12 | 24, factor = 1): ExpectedRange | null {
  if (!(atr > 0) || !(price > 0)) return null;
  const dist = atr * Math.sqrt(hours) * RANGE_MULT_80[hours] * factor;
  return { hours, dist, pct: (dist / price) * 100, factor };
}

export const rangeText = (r: ExpectedRange, price: number): string => `${r.hours}h +/-${fmtDist(r.dist, price)} (${r.pct.toFixed(2)}%)`;

export interface EventContext {
  symbol: string;
  nowMs: number;
  events: readonly RangeEvent[] | null | undefined;
}

/** The ranges for both horizons with the event widening applied where a validated release falls inside that window. */
export function rangesFor(a: Pick<SmcAnalysis, "atr" | "price">, ctx?: EventContext): { r12: ExpectedRange; r24: ExpectedRange; events: Array<RangeEvent & { label: string; tsMs: number }> } | null {
  const cls = ctx ? rangeClassFor(ctx.symbol) : "metals-fx";
  const ev12 = ctx ? validatedEventsInWindow(ctx.events, ctx.nowMs, 12) : [];
  const ev24 = ctx ? validatedEventsInWindow(ctx.events, ctx.nowMs, 24) : [];
  const r12 = expectedRange(a.atr, a.price, 12, ev12.length > 0 ? EVENT_WIDEN[cls][12] : 1);
  const r24 = expectedRange(a.atr, a.price, 24, ev24.length > 0 ? EVENT_WIDEN[cls][24] : 1);
  if (!r12 || !r24) return null;
  return { r12, r24, events: ev24 };
}

const hhmmUtc = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** "Expected range (80% of past moves): 12h +/-18.71 (0.45%), 24h +/-27.92 (0.67%) - volatility, not a direction". With a release in the window it says so and by how much the band was widened. */
export function rangeBriefLine(a: Pick<SmcAnalysis, "atr" | "price">, ctx?: EventContext): string | null {
  const r = rangesFor(a, ctx);
  if (!r) return null;
  const base = `Expected range (80% of past moves): ${rangeText(r.r12, a.price)}, ${rangeText(r.r24, a.price)} - volatility, not a direction`;
  const widened = r.r12.factor > 1 || r.r24.factor > 1;
  if (!widened) return base;
  const e = r.events[0];
  const f = [r.r12.factor > 1 ? `12h x${r.r12.factor}` : null, r.r24.factor > 1 ? `24h x${r.r24.factor}` : null].filter(Boolean).join(", ");
  return `${base}. Widened (${f}) because ${e.label} (${hhmmUtc(e.tsMs)} UTC) falls inside the window - checked on past CPI, payrolls and Fed decisions`;
}

function lastPool(a: Pick<SmcAnalysis, "pools">, kind: "PDH" | "PDL") {
  const ps = a.pools.filter((p) => p.kind === kind);
  return ps.length > 0 ? ps[ps.length - 1] : null;
}

/** "Key levels: PDH 4200.55 (56.50 above), PDL 4141.66 (2.30 below, swept)" - yesterday's high / low relative to price. */
export function keyLevelsLine(a: Pick<SmcAnalysis, "pools" | "price">): string | null {
  const parts: string[] = [];
  for (const kind of ["PDH", "PDL"] as const) {
    const p = lastPool(a, kind);
    if (!p) continue;
    const d = Math.abs(p.price - a.price);
    parts.push(`${kind} ${fmtPrice(p.price)} (${fmtDist(d, a.price)} ${p.price >= a.price ? "above" : "below"}${p.status === "swept" ? ", swept" : ""})`);
  }
  return parts.length > 0 ? `Key levels: ${parts.join(", ")}` : null;
}
