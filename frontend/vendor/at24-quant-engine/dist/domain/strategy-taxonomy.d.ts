export declare const STRATEGY_TAGS: readonly ["TREND", "MOMENTUM", "MEAN_REVERSION", "BREAKOUT", "REVERSAL", "VOLATILITY", "PRICE_ACTION", "MARKET_STRUCTURE", "LIQUIDITY", "MTF", "SESSION", "STATISTICAL", "HYBRID"];
export type StrategyTag = (typeof STRATEGY_TAGS)[number];
export declare function isStrategyTag(value: string): value is StrategyTag;
