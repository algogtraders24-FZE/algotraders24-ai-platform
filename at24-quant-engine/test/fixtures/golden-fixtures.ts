import type { Instrument, OHLCVBar, Timeframe } from "../../src/domain/market-data.js";
import type { MarketSeries } from "../../src/domain/market-series.js";

/**
 * Small, deterministic, synthetic datasets for Quant primitive testing
 * (Q0.2.20). NOT production market data — no market.db, no external API,
 * no broker feed. Every fixture is hand-constructed and reproducible.
 */

export const FIXTURE_INSTRUMENT: Instrument = { symbol: "FIXTURE", assetClass: "other" };
export const FIXTURE_TIMEFRAME: Timeframe = "H1";

const HOUR_MS = 3_600_000;
const BASE_TS = Date.parse("2026-01-05T00:00:00Z"); // a Monday

function bar(index: number, open: number, high: number, low: number, close: number, volume = 1000): OHLCVBar {
  return {
    timestamp: BASE_TS + index * HOUR_MS,
    instrument: FIXTURE_INSTRUMENT,
    timeframe: FIXTURE_TIMEFRAME,
    open,
    high,
    low,
    close,
    volume,
  };
}

function series(bars: readonly OHLCVBar[]): MarketSeries {
  return { instrument: FIXTURE_INSTRUMENT, timeframe: FIXTURE_TIMEFRAME, bars };
}

/** Steady uptrend: close increases by 1 every bar, 30 bars, low volatility. */
export const FIXTURE_TREND: MarketSeries = series(
  Array.from({ length: 30 }, (_, i) => bar(i, 100 + i, 100 + i + 0.5, 100 + i - 0.5, 100 + i + 0.2)),
);

/** Bounded oscillation between ~95 and ~105, 30 bars — no sustained trend. */
export const FIXTURE_RANGE: MarketSeries = series(
  Array.from({ length: 30 }, (_, i) => {
    const mid = 100 + 5 * Math.sin((i / 30) * 4 * Math.PI);
    return bar(i, mid - 0.3, mid + 1, mid - 1, mid + 0.3);
  }),
);

/** Alternating narrow/wide true-range bars, 20 bars — exercises ATR under varying volatility. */
export const FIXTURE_VOLATILITY: MarketSeries = series(
  Array.from({ length: 20 }, (_, i) => {
    const wide = i % 2 === 0;
    const mid = 100;
    const halfRange = wide ? 4 : 0.5;
    return bar(i, mid, mid + halfRange, mid - halfRange, mid + (wide ? 1 : -0.2));
  }),
);

/**
 * A flat segment (bars 0-9) followed by a sharp, sustained move up (bars
 * 10-19) — engineered so a fast SMA(3) crosses above a slow SMA(8) at a
 * known point, for cross_above/cross_below integration tests.
 */
export const FIXTURE_CROSS: MarketSeries = series([
  ...Array.from({ length: 10 }, (_, i) => bar(i, 100, 100.5, 99.5, 100)),
  ...Array.from({ length: 10 }, (_, i) => bar(10 + i, 100 + i * 2, 100 + i * 2 + 1, 100 + i * 2 - 1, 100 + i * 2 + 0.5)),
]);

/** A single large overnight-style gap between bar 4's close and bar 5's open, 10 bars total. */
export const FIXTURE_GAP: MarketSeries = series([
  ...Array.from({ length: 5 }, (_, i) => bar(i, 100, 100.5, 99.5, 100.1)),
  bar(5, 110, 111, 109.5, 110.5),
  ...Array.from({ length: 4 }, (_, i) => bar(6 + i, 110.5 + i, 111.5 + i, 109.5 + i, 110.8 + i)),
]);

/**
 * Same shape as FIXTURE_TREND but with bar index 15 removed from the
 * array entirely, leaving a two-hour gap between bars 14 and 16 —
 * exercises detectTimestampGaps(). Deliberately NOT invalid per
 * validateMarketSeries (a data gap is not the same as an ordering/OHLC
 * defect; see market-series.ts's TimestampGap doc).
 */
export const FIXTURE_MISSING_DATA: MarketSeries = series(
  Array.from({ length: 30 }, (_, i) => i)
    .filter((i) => i !== 15)
    .map((i) => bar(i, 100 + i, 100 + i + 0.5, 100 + i - 0.5, 100 + i + 0.2)),
);

/** Two bars sharing the exact same timestamp (index 5 duplicated) — exercises duplicate-timestamp detection. */
export const FIXTURE_DUPLICATES: MarketSeries = series([
  ...Array.from({ length: 5 }, (_, i) => bar(i, 100 + i, 100 + i + 0.5, 100 + i - 0.5, 100 + i + 0.2)),
  bar(5, 105, 105.5, 104.5, 105.2),
  { ...bar(5, 105, 105.5, 104.5, 105.2), close: 999 }, // same timestamp as the bar above, different content
  ...Array.from({ length: 4 }, (_, i) => bar(6 + i, 106 + i, 106 + i + 0.5, 106 + i - 0.5, 106 + i + 0.2)),
]);

/** Every bar identical: open=high=low=close=100, volume=0 — exercises degenerate/zero-variance indicator behavior. */
export const FIXTURE_CONSTANT: MarketSeries = series(Array.from({ length: 25 }, (_, i) => bar(i, 100, 100, 100, 100, 0)));

/**
 * A clear swing high (bar 10) followed by a decisive break below the prior
 * swing low (bar 3's low), reserved for future market-structure detector
 * tests (Q0.2.17) — no detector exists in Q0.2, so this fixture is not yet
 * exercised by any test, only shaped and documented for that future use.
 */
export const FIXTURE_MARKET_STRUCTURE: MarketSeries = series([
  bar(0, 100, 100.5, 99, 100.2),
  bar(1, 100.2, 101, 100, 100.8),
  bar(2, 100.8, 102, 100.5, 101.5),
  bar(3, 101.5, 102, 98.5, 99),
  bar(4, 99, 100, 98.8, 99.5),
  bar(5, 99.5, 101, 99.2, 100.7),
  bar(6, 100.7, 103, 100.5, 102.8),
  bar(7, 102.8, 106, 102.5, 105.6),
  bar(8, 105.6, 108, 105, 107.5),
  bar(9, 107.5, 110, 107, 109.6),
  bar(10, 109.6, 112, 109.4, 110), // swing high near bar 10
  bar(11, 110, 110.2, 106, 106.5),
  bar(12, 106.5, 107, 102, 102.4),
  bar(13, 102.4, 102.8, 97, 97.3), // decisive break below bar 3's low (98.5)
]);
