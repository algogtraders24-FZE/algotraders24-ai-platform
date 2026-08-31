/**
 * IndicatorReference is the plug point future indicators attach to. Q0 does
 * not implement indicator math (EMA/RSI/ATR/...) — it only defines the
 * addressable name+params shape and the canonical key used to look up a
 * precomputed value in a MarketState (see Q0.3).
 */
export interface IndicatorReference {
  readonly name: string;
  readonly params: readonly (number | string)[];
}

export function indicator(name: string, ...params: readonly (number | string)[]): IndicatorReference {
  return { name, params };
}

export function indicatorKey(ref: IndicatorReference): string {
  return `${ref.name}(${ref.params.join(",")})`;
}
