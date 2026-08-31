export const STRATEGY_TAGS = [
  "TREND",
  "MOMENTUM",
  "MEAN_REVERSION",
  "BREAKOUT",
  "REVERSAL",
  "VOLATILITY",
  "PRICE_ACTION",
  "MARKET_STRUCTURE",
  "LIQUIDITY",
  "MTF",
  "SESSION",
  "STATISTICAL",
  "HYBRID",
] as const;

export type StrategyTag = (typeof STRATEGY_TAGS)[number];

export function isStrategyTag(value: string): value is StrategyTag {
  return (STRATEGY_TAGS as readonly string[]).includes(value);
}
