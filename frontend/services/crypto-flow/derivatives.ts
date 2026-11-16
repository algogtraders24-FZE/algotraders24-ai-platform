// services/crypto-flow/derivatives.ts
// Pure maths for the derivatives positioning panel (no network, no "server-only"; the validation script imports it).
//   funding annualised = rate * (24 / intervalHours) * 365 * 100  (percent)
//   funding label: |annual| < 5 % neutral; 5-20 % "paying"; above 20 % "paying a lot" (the sign decides who pays)
//   open-interest regime from the change of open interest (contracts) and of price over the same window:
//     |OI change| < 1 % or |price change| < 0.2 %  -> flat
//     OI up, price up -> new longs;  OI up, price down -> new shorts;  OI down, price up -> short covering;  OI down, price down -> long unwinding
//   price at an open-interest snapshot = sumOpenInterestValue / sumOpenInterest (the venue value in USDT divided by contracts)
//   crowd: long share >= 60 % long-heavy, <= 40 % short-heavy, else balanced.
import type { CryptoFlowCrowd, CryptoFlowFundingLabel, CryptoFlowFundingRow, CryptoFlowOiRegime, CryptoFlowOiWindow, CryptoFlowRatio } from "@/types/crypto-flow";

export const FUNDING_NEUTRAL_PCT = 5;
export const FUNDING_HIGH_PCT = 20;
export const OI_FLAT_PCT = 1;
export const PRICE_FLAT_PCT = 0.2;
export const CROWD_LONG = 0.6;
export const CROWD_SHORT = 0.4;

export function fundingLabel(annualPct: number): CryptoFlowFundingLabel {
  const a = Math.abs(annualPct);
  if (a < FUNDING_NEUTRAL_PCT) return "neutral";
  if (annualPct > 0) return a >= FUNDING_HIGH_PCT ? "longs paying a lot" : "longs paying";
  return a >= FUNDING_HIGH_PCT ? "shorts paying a lot" : "shorts paying";
}

export function oiRegime(oiChangePct: number, priceChangePct: number): CryptoFlowOiRegime {
  if (Math.abs(oiChangePct) < OI_FLAT_PCT || Math.abs(priceChangePct) < PRICE_FLAT_PCT) return "flat";
  if (oiChangePct > 0) return priceChangePct > 0 ? "new longs" : "new shorts";
  return priceChangePct > 0 ? "short covering" : "long unwinding";
}

export function crowdOf(longShare: number): CryptoFlowCrowd {
  return longShare >= CROWD_LONG ? "long-heavy" : longShare <= CROWD_SHORT ? "short-heavy" : "balanced";
}

export interface RawPremium {
  symbol?: unknown;
  markPrice?: unknown;
  lastFundingRate?: unknown;
  nextFundingTime?: unknown;
}

/** Funding rows for the symbols in `wanted` that appear in the premium-index list. `intervals` maps symbol -> funding interval hours (default 8). */
export function fundingRows(premium: ReadonlyArray<RawPremium>, intervals: ReadonlyMap<string, number>, wanted: ReadonlyArray<string>): CryptoFlowFundingRow[] {
  const rows: CryptoFlowFundingRow[] = [];
  for (const symbol of wanted) {
    const p = premium.find((x) => x.symbol === symbol);
    if (!p) continue;
    const mark = Number(p.markPrice);
    const rate = Number(p.lastFundingRate);
    const next = Number(p.nextFundingTime);
    if (![mark, rate, next].every(Number.isFinite) || !(mark > 0)) continue;
    const intervalHours = intervals.get(symbol) ?? 8;
    const annualPct = rate * (24 / intervalHours) * 365 * 100;
    rows.push({ symbol, markPrice: mark, fundingPct: rate * 100, intervalHours, annualPct, label: fundingLabel(annualPct), nextFundingTime: next });
  }
  return rows;
}

export interface RawOiPoint {
  sumOpenInterest?: unknown;
  sumOpenInterestValue?: unknown;
  timestamp?: unknown;
}

export interface OiSeriesPoint {
  t: number;
  oi: number;
  value: number;
  price: number;
}

/** Hourly open-interest history, oldest first. Drops malformed points. */
export function parseOiHistory(rows: ReadonlyArray<RawOiPoint>): OiSeriesPoint[] {
  const out: OiSeriesPoint[] = [];
  for (const r of rows) {
    const t = Number(r.timestamp);
    const oi = Number(r.sumOpenInterest);
    const value = Number(r.sumOpenInterestValue);
    if (![t, oi, value].every(Number.isFinite) || !(oi > 0) || !(value > 0)) continue;
    out.push({ t, oi, value, price: value / oi });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Change over the last `hours` hourly steps. Null when the history is too short. */
export function oiWindow(series: ReadonlyArray<OiSeriesPoint>, hours: number): CryptoFlowOiWindow | null {
  if (series.length < hours + 1) return null;
  const last = series[series.length - 1];
  const first = series[series.length - 1 - hours];
  const oiChangePct = (100 * (last.oi - first.oi)) / first.oi;
  const priceChangePct = (100 * (last.price - first.price)) / first.price;
  return { hours, oiChangePct, priceChangePct, regime: oiRegime(oiChangePct, priceChangePct) };
}

export interface RawRatioPoint {
  longAccount?: unknown;
  timestamp?: unknown;
}

/** Latest long share from a long/short ratio list (the list is oldest first). Null when empty or malformed. */
export function latestRatio(rows: ReadonlyArray<RawRatioPoint>): CryptoFlowRatio | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const share = Number(rows[i].longAccount);
    if (Number.isFinite(share) && share >= 0 && share <= 1) return { longPct: share * 100, crowd: crowdOf(share) };
  }
  return null;
}

export function latestTakerRatio(rows: ReadonlyArray<{ buySellRatio?: unknown }>): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = Number(rows[i].buySellRatio);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}
