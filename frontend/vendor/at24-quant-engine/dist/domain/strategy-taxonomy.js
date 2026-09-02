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
];
export function isStrategyTag(value) {
    return STRATEGY_TAGS.includes(value);
}
