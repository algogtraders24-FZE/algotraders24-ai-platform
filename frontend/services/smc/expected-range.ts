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

export interface ExpectedRange {
  hours: 12 | 24;
  /** Half-width in price units (the move stays within +/- this about 80% of the time). */
  dist: number;
  pct: number;
}

export function expectedRange(atr: number, price: number, hours: 12 | 24): ExpectedRange | null {
  if (!(atr > 0) || !(price > 0)) return null;
  const dist = atr * Math.sqrt(hours) * RANGE_MULT_80[hours];
  return { hours, dist, pct: (dist / price) * 100 };
}

export const rangeText = (r: ExpectedRange, price: number): string => `${r.hours}h +/-${fmtDist(r.dist, price)} (${r.pct.toFixed(2)}%)`;

/** "Expected range (80%): 12h +/-18.69 (0.45%), 24h +/-27.00 (0.65%) - a volatility range, not a direction". */
export function rangeBriefLine(a: Pick<SmcAnalysis, "atr" | "price">): string | null {
  const r12 = expectedRange(a.atr, a.price, 12);
  const r24 = expectedRange(a.atr, a.price, 24);
  if (!r12 || !r24) return null;
  return `Expected range (80% of past moves): ${rangeText(r12, a.price)}, ${rangeText(r24, a.price)} - volatility, not a direction`;
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
