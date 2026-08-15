// lib/microstructure/microstructure-calculation.ts
// Sprint D2.8.5, Phase 3 - the ONLY place any microstructure derivation is
// computed. Pure, deterministic, no I/O, no LLM involvement whatsoever -
// every formula here is the exact one the sprint brief specifies, over
// already-validated MicrostructureField inputs (lib/microstructure/
// microstructure-validation.ts has already rejected anything non-finite/
// negative/crossed before these functions ever see it). Every function
// returns "unavailable" (never a guessed/zero value) the moment any
// required input isn't itself "available"/"stale" - see hasValue() in
// microstructure-field.ts. Lives under lib/ (not services/) so a provider
// adapter can call it directly - see microstructure-field.ts's header.
import type { MicrostructureField, MicrostructureOrderBookLevel, MicrostructureTrade } from "@/types/microstructure";
import { availableField, unavailableField, propagateState, hasValue } from "./microstructure-field";

export const MICROSTRUCTURE_CALCULATION_VERSION = "1.0.0";

/** midPrice = (bid + ask) / 2 - only when both bid and ask carry a real value. */
export function computeMidPrice(bid: MicrostructureField<number>, ask: MicrostructureField<number>): MicrostructureField<number> {
  if (!hasValue(bid) || !hasValue(ask)) return unavailableField("mid price requires both bid and ask to be available");
  return availableField((bid.value + ask.value) / 2);
}

/**
 * spread = ask - bid - only when both exist, both are finite, and
 * ask >= bid. The upstream bid/ask fields are already validated
 * (toBidAskFields already rejects a crossed pair as "invalid" before
 * either field can be "available"), so the ask < bid branch here is a
 * defensive second check, never the primary gate - matching D2.8.1's own
 * "spread may ONLY be derived when both bid and ask are real and valid"
 * rule verbatim.
 */
export function computeSpread(bid: MicrostructureField<number>, ask: MicrostructureField<number>): MicrostructureField<number> {
  if (!hasValue(bid) || !hasValue(ask)) return unavailableField("spread requires both bid and ask to be available");
  if (ask.value < bid.value) return unavailableField("spread cannot be computed from a crossed market (ask < bid)");
  return availableField(ask.value - bid.value);
}

/** bidDepth/askDepth = sum(valid level quantities) - a not_supported_by_provider or invalid order book propagates that same state, never silently becomes 0. */
export function computeSideDepth(levels: MicrostructureField<MicrostructureOrderBookLevel[]>): MicrostructureField<number> {
  if (!hasValue(levels)) return propagateState(levels, "depth requires real order-book levels");
  const total = levels.value.reduce((sum, level) => sum + level.quantity, 0);
  return availableField(total);
}

/** depthImbalance = (bidDepth - askDepth) / (bidDepth + askDepth), only when the denominator is strictly positive - an all-zero book has no meaningful imbalance, so it is honestly unavailable rather than reported as 0. */
export function computeDepthImbalance(bidDepth: MicrostructureField<number>, askDepth: MicrostructureField<number>): MicrostructureField<number> {
  if (!hasValue(bidDepth) || !hasValue(askDepth)) return unavailableField("depth imbalance requires both bidDepth and askDepth to be available");
  const denominator = bidDepth.value + askDepth.value;
  if (!(denominator > 0)) return unavailableField("depth imbalance requires a strictly positive combined depth");
  return availableField((bidDepth.value - askDepth.value) / denominator);
}

/**
 * buyVolume = sum(quantity) over trades whose aggressorSide === "buy";
 * sellVolume mirrors it for "sell". A trade whose own aggressorSide is
 * unavailable contributes to neither sum (never guessed from price
 * direction or from which side of the book it printed near). If the
 * trade array itself has no aggressor evidence at all, both volumes are
 * reported unavailable, not 0 - the sprint's own explicit example.
 */
export function computeAggressorVolumes(trades: MicrostructureField<MicrostructureTrade[]>): { buyVolume: MicrostructureField<number>; sellVolume: MicrostructureField<number> } {
  if (!hasValue(trades)) {
    const reason = "buy/sell volume requires real trade data with aggressor-side evidence";
    return { buyVolume: propagateState(trades, reason), sellVolume: propagateState(trades, reason) };
  }
  let buy = 0;
  let sell = 0;
  let anyAggressorEvidence = false;
  for (const trade of trades.value) {
    if (trade.aggressorSide.state !== "available" && trade.aggressorSide.state !== "stale") continue;
    anyAggressorEvidence = true;
    if (trade.aggressorSide.value === "buy") buy += trade.quantity;
    else if (trade.aggressorSide.value === "sell") sell += trade.quantity;
  }
  if (!anyAggressorEvidence) {
    const reason = "no trade in this snapshot carried real aggressor-side evidence - this provider does not supply it";
    return { buyVolume: unavailableField(reason), sellVolume: unavailableField(reason) };
  }
  return { buyVolume: availableField(buy), sellVolume: availableField(sell) };
}

/** volumeDelta = buyVolume - sellVolume - only when both are themselves real (i.e. only for a provider that genuinely supplies aggressor-side evidence, per computeAggressorVolumes above). */
export function computeVolumeDelta(buyVolume: MicrostructureField<number>, sellVolume: MicrostructureField<number>): MicrostructureField<number> {
  if (!hasValue(buyVolume) || !hasValue(sellVolume)) return unavailableField("volume delta requires both buyVolume and sellVolume to be available");
  return availableField(buyVolume.value - sellVolume.value);
}

const LIQUIDITY_CONCENTRATION_TOP_LEVELS = 3;

/**
 * liquidityConcentration = (sum of quantity in the top N levels of each
 * side) / (total quantity across both sides), N = 3 by default - a real,
 * documented, deterministic measure of how much of THIS venue's visible
 * depth sits closest to the touch. Explicitly venue/feed-specific (per
 * D2.8.2-D2.8.4's own established rule): this is never presented as
 * "market liquidity", only as this provider's own order-book
 * concentration.
 */
export function computeLiquidityConcentration(
  bidLevels: MicrostructureField<MicrostructureOrderBookLevel[]>,
  askLevels: MicrostructureField<MicrostructureOrderBookLevel[]>,
  topLevels: number = LIQUIDITY_CONCENTRATION_TOP_LEVELS,
): MicrostructureField<number> {
  if (!hasValue(bidLevels) || !hasValue(askLevels)) return unavailableField("liquidity concentration requires real order-book levels on both sides");
  const totalQuantity = [...bidLevels.value, ...askLevels.value].reduce((sum, level) => sum + level.quantity, 0);
  if (!(totalQuantity > 0)) return unavailableField("liquidity concentration requires strictly positive total depth");
  const topQuantity =
    bidLevels.value.slice(0, topLevels).reduce((sum, level) => sum + level.quantity, 0) +
    askLevels.value.slice(0, topLevels).reduce((sum, level) => sum + level.quantity, 0);
  return availableField(topQuantity / totalQuantity);
}
