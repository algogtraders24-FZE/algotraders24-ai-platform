import type { StrategySpec } from "../src/domain/strategy-spec.js";
import type { MarketState } from "../src/domain/market-state.js";
import { indicator, indicatorKey } from "../src/domain/indicator-reference.js";
import { and, comparison, indicatorOperand, literal } from "../src/domain/expression.js";
import type { Instrument, Timeframe } from "../src/domain/market-data.js";

export const XAUUSD: Instrument = { symbol: "XAUUSD", assetClass: "metal" };
export const H1: Timeframe = "H1";

const ema20 = indicator("EMA", 20);
const ema50 = indicator("EMA", 50);
const rsi14 = indicator("RSI", 14);

export function buildStrategySpec(): StrategySpec {
  return {
    identity: { strategyId: "g01-liquidity-sweep", name: "Liquidity Sweep MSS FVG" },
    version: "1.0.0",
    metadata: { createdAt: Date.parse("2026-01-01T00:00:00Z") },
    instruments: [XAUUSD],
    timeframes: [H1],
    parameters: [{ key: "rsiThreshold", type: "number", defaultValue: 55, min: 0, max: 100 }],
    entryRules: [
      {
        id: "entry-buy-ema-rsi",
        direction: "BUY",
        condition: and(
          comparison(">", indicatorOperand(ema20), indicatorOperand(ema50)),
          comparison(">", indicatorOperand(rsi14), literal(55)),
        ),
      },
    ],
    exitRules: [
      {
        id: "exit-ema-cross",
        condition: comparison("<", indicatorOperand(ema20), indicatorOperand(ema50)),
        appliesTo: "BUY",
      },
    ],
    risk: {
      sizing: { method: "percent-equity-risk", percent: 1 },
      stopLoss: { type: "atr-multiple", atrMultiple: 1.5, atrPeriod: 14 },
      takeProfit: { type: "risk-multiple", rMultiple: 2 },
      maxPositionSize: 5,
    },
    execution: { fillModel: "next-bar-open" },
  };
}

export function buildMarketState(overrides?: {
  ema20?: number;
  ema50?: number;
  rsi14?: number;
  asOf?: number;
}): MarketState {
  const asOf = overrides?.asOf ?? Date.parse("2026-06-01T12:00:00Z");
  const values = new Map<string, number | boolean>([
    [indicatorKey(ema20), overrides?.ema20 ?? 2400],
    [indicatorKey(ema50), overrides?.ema50 ?? 2380],
    [indicatorKey(rsi14), overrides?.rsi14 ?? 60],
  ]);
  return {
    instrument: XAUUSD,
    timeframe: H1,
    asOf,
    bars: [
      {
        timestamp: asOf,
        instrument: XAUUSD,
        timeframe: H1,
        open: 2395,
        high: 2405,
        low: 2390,
        close: 2401,
        volume: 1200,
      },
    ],
    indicatorValues: values,
  };
}

export { ema20, ema50, rsi14 };
