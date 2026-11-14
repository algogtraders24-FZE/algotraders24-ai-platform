// services/crypto-flow/zones.ts
// Pure maths for Flow Zones (no network, no "server-only", so the validation script can import it).
//
// Profile: every closed bar puts its volume into ONE price bucket, chosen by the bar's typical price (high + low + close) / 3.
// The bar's buyer-aggressor volume is the kline taker-buy volume, the seller-aggressor volume is the rest.
//   bucket index = floor(typical / step + 0.5), step = last close * stepPct / 100, bucket centre = index * step.
// POC (point of control) = the bucket with the most volume (lowest index on a tie).
// Value area = 70 % of the volume, grown around the POC: each step takes the larger of the next bucket above and the next
// bucket below (above on a tie; an empty bucket counts as 0) until 70 % is reached.
// Buyer zone = the bucket at least half a step below the price with the largest (buy - sell) when that is positive
// (nearest to the price on a tie). Seller zone mirrors it above the price.
// Book walls: resting orders aggregated into 0.2 % bands of the last price (floor), by USDT notional, top three per side.
import type {
  CryptoFlowBook,
  CryptoFlowLookbackConfig,
  CryptoFlowProfileBucket,
  CryptoFlowValueState,
  CryptoFlowWall,
  CryptoFlowZone,
  CryptoFlowZones,
} from "@/types/crypto-flow";
import type { RawKline } from "./compute";

export const VALUE_AREA_SHARE = 0.7;
export const WALL_BAND_PCT = 0.2;
export const WALL_COUNT = 3;
/** Below this many trades per minute (mean over the lookback) the profile is too thin to read. */
export const THIN_TRADES_PER_MINUTE = 20;

export interface ZoneBar {
  t: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
  takerBuy: number;
}

export function parseZoneBars(rows: ReadonlyArray<RawKline>, nowMs: number): ZoneBar[] {
  const bars: ZoneBar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 11) continue;
    const t = Number(row[0]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    const closeTime = Number(row[6]);
    const trades = Number(row[8]);
    const takerBuy = Number(row[9]);
    if (![t, high, low, close, volume, closeTime, trades, takerBuy].every(Number.isFinite)) continue;
    if (closeTime >= nowMs) continue; // still open
    bars.push({ t, high, low, close, volume, trades, takerBuy });
  }
  return bars;
}

interface Bucket {
  buy: number;
  sell: number;
}

/** Bucket index of a price. floor(x + 0.5), never banker's rounding, so JS and Python agree. */
export function bucketIndex(typical: number, step: number): number {
  return Math.floor(typical / step + 0.5);
}

function pctFrom(price: number, ref: number): number {
  return ref > 0 ? 100 * (price / ref - 1) : 0;
}

export interface Profile {
  step: number;
  minIdx: number;
  maxIdx: number;
  /** Dense array from minIdx to maxIdx (empty buckets are zero). */
  buckets: Bucket[];
  total: number;
}

export function buildProfile(bars: ReadonlyArray<ZoneBar>, stepPct: number): Profile | null {
  if (bars.length === 0) return null;
  const lastClose = bars[bars.length - 1].close;
  const step = (lastClose * stepPct) / 100;
  if (!(step > 0)) return null;
  const map = new Map<number, Bucket>();
  let minIdx = Infinity;
  let maxIdx = -Infinity;
  let total = 0;
  for (const b of bars) {
    const idx = bucketIndex((b.high + b.low + b.close) / 3, step);
    const cur = map.get(idx) ?? { buy: 0, sell: 0 };
    cur.buy += b.takerBuy;
    cur.sell += b.volume - b.takerBuy;
    map.set(idx, cur);
    total += b.volume;
    if (idx < minIdx) minIdx = idx;
    if (idx > maxIdx) maxIdx = idx;
  }
  const buckets: Bucket[] = [];
  for (let i = minIdx; i <= maxIdx; i++) buckets.push(map.get(i) ?? { buy: 0, sell: 0 });
  return { step, minIdx, maxIdx, buckets, total };
}

/** Index (into profile.buckets) of the point of control. */
export function pointOfControl(p: Profile): number {
  let best = 0;
  let bestVol = -1;
  for (let i = 0; i < p.buckets.length; i++) {
    const v = p.buckets[i].buy + p.buckets[i].sell;
    if (v > bestVol) {
      bestVol = v;
      best = i;
    }
  }
  return best;
}

/** [lo, hi] indices (into profile.buckets) of the value area around `poc`. */
export function valueArea(p: Profile, poc: number): [number, number] {
  const vol = (i: number) => p.buckets[i].buy + p.buckets[i].sell;
  let lo = poc;
  let hi = poc;
  let sum = vol(poc);
  const target = VALUE_AREA_SHARE * p.total;
  while (sum < target && (lo > 0 || hi < p.buckets.length - 1)) {
    const up = hi < p.buckets.length - 1 ? vol(hi + 1) : -1;
    const down = lo > 0 ? vol(lo - 1) : -1;
    if (up >= down) {
      hi += 1;
      sum += up;
    } else {
      lo -= 1;
      sum += down;
    }
  }
  return [lo, hi];
}

function zoneOf(p: Profile, i: number, net: number, lastPrice: number): CryptoFlowZone {
  const price = (p.minIdx + i) * p.step;
  return { price, distancePct: pctFrom(price, lastPrice), netSharePct: p.total > 0 ? (100 * net) / p.total : 0 };
}

export function pickZones(p: Profile, lastPrice: number): { buyer: CryptoFlowZone | null; seller: CryptoFlowZone | null } {
  const gap = p.step / 2;
  let bi = -1;
  let bNet = 0;
  let si = -1;
  let sNet = 0;
  for (let i = 0; i < p.buckets.length; i++) {
    const price = (p.minIdx + i) * p.step;
    const net = p.buckets[i].buy - p.buckets[i].sell;
    if (price <= lastPrice - gap && net > 0 && net >= bNet) {
      bi = i;
      bNet = net; // ">=" keeps the later (nearer to the price) bucket on a tie
    }
    if (price >= lastPrice + gap && -net > 0 && (si < 0 || -net > sNet)) {
      si = i;
      sNet = -net; // ">" keeps the earlier (nearer to the price) bucket on a tie
    }
  }
  return { buyer: bi >= 0 ? zoneOf(p, bi, bNet, lastPrice) : null, seller: si >= 0 ? zoneOf(p, si, sNet, lastPrice) : null };
}

export type RawBookRow = ReadonlyArray<string | number>;
export interface RawBook {
  bids: ReadonlyArray<RawBookRow>;
  asks: ReadonlyArray<RawBookRow>;
}

function bandWalls(rows: ReadonlyArray<RawBookRow>, bandSize: number, lastPrice: number): CryptoFlowWall[] {
  const map = new Map<number, number>();
  for (const r of rows) {
    const price = Number(r?.[0]);
    const qty = Number(r?.[1]);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) continue;
    const idx = Math.floor(price / bandSize);
    map.set(idx, (map.get(idx) ?? 0) + price * qty);
  }
  return [...map.entries()]
    .map(([idx, notional]) => {
      const centre = (idx + 0.5) * bandSize;
      return { price: centre, distancePct: pctFrom(centre, lastPrice), notional };
    })
    .sort((a, b) => b.notional - a.notional || Math.abs(a.distancePct) - Math.abs(b.distancePct))
    .slice(0, WALL_COUNT);
}

/** Top walls per side and the bid/ask imbalance inside the part of the book both sides cover. Null when the book is empty. */
export function bookWalls(raw: RawBook, lastPrice: number): CryptoFlowBook | null {
  const num = (r: RawBookRow) => [Number(r?.[0]), Number(r?.[1])] as const;
  const bids = raw.bids.map(num).filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0);
  const asks = raw.asks.map(num).filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0);
  if (bids.length === 0 || asks.length === 0 || !(lastPrice > 0)) return null;
  const lowestBid = Math.min(...bids.map(([p]) => p));
  const highestAsk = Math.max(...asks.map(([p]) => p));
  const cover = Math.min(lastPrice - lowestBid, highestAsk - lastPrice);
  if (!(cover > 0)) return null;
  const bandSize = (lastPrice * WALL_BAND_PCT) / 100;
  let bidSum = 0;
  let askSum = 0;
  for (const [p, q] of bids) if (p >= lastPrice - cover) bidSum += p * q;
  for (const [p, q] of asks) if (p <= lastPrice + cover) askSum += p * q;
  return {
    bids: bandWalls(raw.bids, bandSize, lastPrice),
    asks: bandWalls(raw.asks, bandSize, lastPrice),
    coveragePct: (100 * cover) / lastPrice,
    imbalancePct: bidSum + askSum > 0 ? (100 * (bidSum - askSum)) / (bidSum + askSum) : 0,
  };
}

/** Mid price of the best bid and best ask; null when the book is empty. */
export function bookMid(raw: RawBook | null): number | null {
  if (!raw) return null;
  const bids = raw.bids.map((r) => Number(r?.[0])).filter((p) => Number.isFinite(p) && p > 0);
  const asks = raw.asks.map((r) => Number(r?.[0])).filter((p) => Number.isFinite(p) && p > 0);
  if (bids.length === 0 || asks.length === 0) return null;
  return (Math.max(...bids) + Math.min(...asks)) / 2;
}

/** Everything the Flow Zones card needs. Null when there are no closed bars. */
export function computeFlowZones(
  symbol: string,
  rows: ReadonlyArray<RawKline>,
  rawBook: RawBook | null,
  nowMs: number,
  venue: string,
  cfg: CryptoFlowLookbackConfig,
): CryptoFlowZones | null {
  const all = parseZoneBars(rows, nowMs);
  const bars = all.slice(Math.max(0, all.length - cfg.bars));
  if (bars.length < 12) return null;
  const last = bars[bars.length - 1];
  // The price the zones are measured from: the live book mid when the book loaded (a 15-minute bar can be 15 minutes old), else the last close.
  const lastPrice = bookMid(rawBook) ?? last.close;
  const minutes = bars.length * cfg.barMinutes;
  const trades = bars.reduce((s, b) => s + b.trades, 0);
  const tradesPerMinute = trades / minutes;
  const thin = tradesPerMinute < THIN_TRADES_PER_MINUTE;
  const base: CryptoFlowZones = {
    symbol,
    venue,
    lookback: cfg.id,
    asOf: last.t,
    lastPrice,
    stepPct: cfg.stepPct,
    tradesPerMinute: Math.round(tradesPerMinute),
    thin,
    profile: [],
    poc: null,
    valueAreaLow: null,
    valueAreaHigh: null,
    state: null,
    buyerZone: null,
    sellerZone: null,
    book: null,
  };
  if (thin) return base;
  const profile = buildProfile(bars, cfg.stepPct);
  if (!profile || profile.total <= 0) return base;
  const pocIdx = pointOfControl(profile);
  const [lo, hi] = valueArea(profile, pocIdx);
  const vaLow = (profile.minIdx + lo) * profile.step;
  const vaHigh = (profile.minIdx + hi) * profile.step;
  const state: CryptoFlowValueState = lastPrice > vaHigh ? "above" : lastPrice < vaLow ? "below" : "inside";
  const { buyer, seller } = pickZones(profile, lastPrice);
  const pocB = profile.buckets[pocIdx];
  const out: CryptoFlowProfileBucket[] = profile.buckets.map((b, i) => ({ price: (profile.minIdx + i) * profile.step, buy: b.buy, sell: b.sell }));
  return {
    ...base,
    profile: out,
    poc: zoneOf(profile, pocIdx, pocB.buy + pocB.sell, lastPrice), // for the POC the share is its volume share, not a net
    valueAreaLow: vaLow,
    valueAreaHigh: vaHigh,
    state,
    buyerZone: buyer,
    sellerZone: seller,
    book: rawBook ? bookWalls(rawBook, lastPrice) : null,
  };
}
