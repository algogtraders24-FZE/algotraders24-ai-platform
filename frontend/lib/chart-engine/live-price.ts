// lib/chart-engine/live-price.ts
// Keeps an analysis and a trade plan tied to the price the trader sees NOW.
//  1. applyLiveQuote(): the candle feed can lag the live quote by up to a minute or two; before the engine reads the chart, the forming candle is updated with the
//     live mid price (close, and high / low when the price went beyond them). Only the candle of the current period is touched; nothing is appended or invented.
//  2. planFreshness(): a plan computed a while ago may no longer make sense once the price has moved (it already hit the target or the stop, a limit entry is now
//     on the wrong side of the market, a market entry is far from the price). The chart then asks for a fresh analysis instead of showing a stale plan.
// Pure and unit-tested (scripts/validate-live-price.ts).
import type { ChartCandle } from "@/types/chart-data";

const MINUTE = 60_000;
const TIMEFRAME_MS: Record<string, number> = { "1m": MINUTE, "5m": 5 * MINUTE, "15m": 15 * MINUTE, "30m": 30 * MINUTE, "1h": 60 * MINUTE, "4h": 240 * MINUTE, "1d": 1440 * MINUTE, "1w": 10080 * MINUTE };

export const timeframeMs = (timeframe: string): number | undefined => TIMEFRAME_MS[timeframe];

/** Returns the candles with the forming candle brought up to the live quote; the same array when nothing needs to change. */
export function applyLiveQuote(candles: ChartCandle[], quote: { bid: number; ask: number } | undefined, intervalMs: number | undefined, nowMs: number = Date.now()): ChartCandle[] {
  if (!quote || !intervalMs || candles.length === 0) return candles;
  const mid = (quote.bid + quote.ask) / 2;
  if (!Number.isFinite(mid) || mid <= 0) return candles;
  const last = candles[candles.length - 1];
  // only the candle of the CURRENT period is the forming one; if the feed is a whole period behind (or the market is closed) nothing is patched
  if (nowMs < last.time || nowMs >= last.time + intervalMs) return candles;
  if (last.close === mid && last.high >= mid && last.low <= mid) return candles;
  const patched: ChartCandle = { ...last, close: mid, high: Math.max(last.high, mid), low: Math.min(last.low, mid) };
  return [...candles.slice(0, -1), patched];
}

export interface PlanLike {
  dir: "long" | "short";
  entryType: "market" | "limit";
  entry: number;
  stop: number;
  target: number;
}

export interface MarketCheck {
  ok: boolean;
  entry: number;
  risk: number;
  reward: number;
  rr: number;
  reason: string | null;
}

/** A market order at the live price with the plan's own stop and target: valid only while the price is still between them. */
export function marketOrderCheck(plan: { dir: "long" | "short"; stop: number; target: number }, quote: { bid: number; ask: number }): MarketCheck {
  const long = plan.dir === "long";
  const entry = long ? quote.ask : quote.bid; // a buy fills at the ask, a sell at the bid
  const risk = Math.abs(entry - plan.stop);
  const reward = Math.abs(plan.target - entry);
  const between = long ? plan.stop < entry && entry < plan.target : plan.target < entry && entry < plan.stop;
  if (!Number.isFinite(entry) || entry <= 0) return { ok: false, entry, risk: 0, reward: 0, rr: 0, reason: "No live price yet." };
  if (!between) return { ok: false, entry, risk, reward, rr: risk > 0 ? reward / risk : 0, reason: long ? (entry <= plan.stop ? "Price is already at or below the stop." : "Price is already at or above the target.") : (entry >= plan.stop ? "Price is already at or above the stop." : "Price is already at or below the target.") };
  return { ok: true, entry, risk, reward, rr: reward / risk, reason: null };
}

export interface Freshness {
  ok: boolean;
  /** Plain words for the trader when the plan is no longer valid. */
  reason: string | null;
}

/** Is this plan still sensible at the live price? `price` is the live mid. */
export function planFreshness(plan: PlanLike, price: number): Freshness {
  if (!Number.isFinite(price) || price <= 0) return { ok: true, reason: null };
  const long = plan.dir === "long";
  const risk = Math.abs(plan.entry - plan.stop);
  if (long ? price <= plan.stop : price >= plan.stop) return { ok: false, reason: "Price has already reached the stop level." };
  if (long ? price >= plan.target : price <= plan.target) return { ok: false, reason: "Price has already reached the target, so this move has played out." };
  if (plan.entryType === "limit") {
    if (long ? price <= plan.entry : price >= plan.entry) return { ok: false, reason: "Price is already at or through the limit entry, so it would fill at once." };
  } else if (risk > 0 && Math.abs(price - plan.entry) > 0.25 * risk) {
    return { ok: false, reason: "Price has moved away from the entry since this analysis." };
  }
  return { ok: true, reason: null };
}
