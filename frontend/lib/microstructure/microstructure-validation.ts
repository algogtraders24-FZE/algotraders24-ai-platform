// lib/microstructure/microstructure-validation.ts
// Sprint D2.8.5, Phase 5 - turns raw provider numbers/strings into typed
// MicrostructureField values, rejecting (never repairing) anything
// structurally suspicious: non-finite numbers, negative quantities, a
// crossed market (ask < bid), malformed order-book levels, missing/
// impossible timestamps. Pure, deterministic, no I/O - the same
// discipline as services/market-data/market-snapshot-integrity.service.ts,
// which this module reuses (via assessFreshness) rather than duplicating.
// Lives under lib/ so provider adapters (lib/market-data/providers/*) can
// call it directly - see microstructure-field.ts's header for why.
import type { MarketCategory } from "@/types/market";
import type { MicrostructureField, MicrostructureOrderBookLevel, MicrostructureTrade, MicrostructureFreshnessStatus } from "@/types/microstructure";
import { assessFreshness } from "@/services/market-data/freshness-policy.service";
import { availableField, unavailableField, invalidField } from "./microstructure-field";

export const MICROSTRUCTURE_VALIDATION_VERSION = "1.0.0";

/** A single price is valid only when finite and strictly positive - same bar D2.8.1 already established for MarketSnapshot.bid/ask. */
export function isValidPrice(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** A quantity is valid when finite and non-negative - zero is a legitimate "no size at this level" value, negative is never legitimate. */
export function isValidQuantity(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Builds bid/ask fields together (never independently) because their
 * validity depends on each other: a bid without an ask (or vice versa) is
 * unavailable, not a lone valid number; ask < bid is a crossed market and
 * both are invalid, never "fixed" by swapping or clamping.
 */
export function toBidAskFields(bid: number | undefined, ask: number | undefined): { bid: MicrostructureField<number>; ask: MicrostructureField<number> } {
  if (bid === undefined || ask === undefined) {
    return { bid: unavailableField("provider did not report both bid and ask"), ask: unavailableField("provider did not report both bid and ask") };
  }
  if (!isValidPrice(bid) || !isValidPrice(ask)) {
    return { bid: invalidField(`bid (${bid}) or ask (${ask}) is not a finite, positive number`), ask: invalidField(`bid (${bid}) or ask (${ask}) is not a finite, positive number`) };
  }
  if (ask < bid) {
    return { bid: invalidField(`crossed market: ask (${ask}) < bid (${bid})`), ask: invalidField(`crossed market: ask (${ask}) < bid (${bid})`) };
  }
  return { bid: availableField(bid), ask: availableField(ask) };
}

/**
 * Builds one side of the order book (bids or asks). Any single malformed
 * level (non-finite price, negative/non-finite quantity) invalidates the
 * WHOLE side rather than being silently dropped - a partially-parsed book
 * with an unknown gap could distort a depth/imbalance calculation more
 * dangerously than an honest "invalid".
 */
export function toOrderBookLevelsField(rawLevels: Array<[string, string]> | undefined): MicrostructureField<MicrostructureOrderBookLevel[]> {
  if (rawLevels === undefined) {
    return unavailableField("provider did not report order-book levels");
  }
  if (rawLevels.length === 0) {
    return invalidField("provider returned an empty order-book level array");
  }
  const levels: MicrostructureOrderBookLevel[] = [];
  for (const [priceRaw, quantityRaw] of rawLevels) {
    const price = Number.parseFloat(priceRaw);
    const quantity = Number.parseFloat(quantityRaw);
    if (!isValidPrice(price) || !isValidQuantity(quantity)) {
      return invalidField(`order-book contains a malformed level (price="${priceRaw}", quantity="${quantityRaw}")`);
    }
    levels.push({ price, quantity });
  }
  return availableField(levels);
}

/**
 * Maps a provider's raw trade rows into MicrostructureTrade[]. `mapTrade`
 * is injected per-provider (Binance's isBuyerMaker today; a future
 * provider without any aggressor evidence should pass a mapper that
 * always returns undefined for aggressorSide, which this function
 * honestly turns into an unavailable aggressorSide field per-trade - it
 * never guesses a side from price movement).
 */
export function toTradesField<TRaw>(
  rawTrades: TRaw[] | undefined,
  mapTrade: (raw: TRaw) => { price: number; quantity: number; timestamp: string; aggressorSide: "buy" | "sell" | undefined } | undefined,
): MicrostructureField<MicrostructureTrade[]> {
  if (rawTrades === undefined) {
    return unavailableField("provider did not report trade data");
  }
  const trades: MicrostructureTrade[] = [];
  for (const raw of rawTrades) {
    const mapped = mapTrade(raw);
    if (!mapped || !isValidPrice(mapped.price) || !isValidQuantity(mapped.quantity) || !mapped.timestamp) continue; // a single malformed trade row is dropped, not fabricated - the array itself stays available if at least one real trade parses
    trades.push({
      price: mapped.price,
      quantity: mapped.quantity,
      timestamp: mapped.timestamp,
      aggressorSide: mapped.aggressorSide === undefined ? unavailableField("provider did not supply aggressor-side evidence for this trade") : availableField(mapped.aggressorSide),
    });
  }
  if (trades.length === 0) {
    return invalidField("no trade row in the provider response could be parsed into a valid trade");
  }
  return availableField(trades);
}

/** A sequence/update identifier is valid only when it's a non-empty, purely numeric string - Binance's lastUpdateId/U/u are always unsigned integers; a malformed or non-numeric identifier is rejected rather than trusted. */
export function toSequenceIdField(rawSequenceId: number | string | undefined): MicrostructureField<string> {
  if (rawSequenceId === undefined) {
    return unavailableField("provider did not report a sequence/update identifier");
  }
  const asString = String(rawSequenceId);
  if (!/^\d+$/.test(asString)) {
    return invalidField(`sequence identifier "${asString}" is not a valid non-negative integer`);
  }
  return availableField(asString);
}

const FUTURE_TIMESTAMP_TOLERANCE_MS = 5_000;

/**
 * Reuses assessFreshness() (services/market-data/freshness-policy.service.ts)
 * verbatim for the fresh/stale/unknown classification - never a second,
 * competing freshness system. Adds exactly one check assessFreshness does
 * not perform: assessFreshness clamps a negative age to 0 (treating a
 * future timestamp as perfectly fresh), which would hide a genuinely
 * malformed reading - here a timestamp more than a few seconds in the
 * future is classified "invalid" instead.
 */
export function assessMicrostructureFreshness(timestamp: string | undefined, assetClass: MarketCategory, nowMs: number): MicrostructureFreshnessStatus {
  if (timestamp) {
    const timestampMs = new Date(timestamp).getTime();
    if (!Number.isNaN(timestampMs) && timestampMs > nowMs + FUTURE_TIMESTAMP_TOLERANCE_MS) {
      return "invalid";
    }
  }
  return assessFreshness({ subject: { kind: "quote", assetClass }, timestamp, nowMs }).status;
}
