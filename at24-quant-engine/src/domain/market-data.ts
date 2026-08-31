export type Timeframe =
  | "M1"
  | "M5"
  | "M15"
  | "M30"
  | "H1"
  | "H4"
  | "D1"
  | "W1"
  | "MN1";

export type AssetClass =
  | "forex"
  | "metal"
  | "crypto"
  | "index"
  | "equity"
  | "other";

export interface Instrument {
  readonly symbol: string;
  readonly assetClass?: AssetClass;
}

export interface OHLCVBar {
  readonly timestamp: number;
  readonly instrument: Instrument;
  readonly timeframe: Timeframe;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * providerId/datasetId are opaque identifiers. The Quant Engine never talks
 * to a broker/provider directly — MarketDataSeries is the only shape a
 * strategy or the runtime is allowed to depend on (see Q0.4 / ADR-009).
 */
export interface MarketDataSource {
  readonly providerId: string;
  readonly datasetId: string;
}

export interface MarketDataSeries {
  readonly instrument: Instrument;
  readonly timeframe: Timeframe;
  readonly source: MarketDataSource;
  readonly bars: readonly OHLCVBar[];
}
