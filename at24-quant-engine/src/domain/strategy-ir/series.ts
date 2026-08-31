/** Q0.7.6 — canonical price series, always assumed available. */
export type PriceSeriesField = "OPEN" | "HIGH" | "LOW" | "CLOSE" | "VOLUME";

/**
 * Q0.7.6 — reserved series that a source platform MAY provide but AT24's
 * own market-data model (domain/market-data.ts's OHLCVBar) does not
 * carry today. Declared now so a future data-detail sprint extends this
 * union rather than inventing a parallel one; no IR validator may REQUIRE
 * one of these to exist.
 */
export type ReservedPriceSeriesField = "BID" | "ASK" | "TICK_VOLUME" | "BUY_VOLUME" | "SELL_VOLUME" | "SPREAD" | "DEPTH";

/**
 * Q0.7.8/9 — a series reference with an EXPLICIT bar offset, never an
 * implicit array index. `offset: 0` = current bar, `offset: 1` = one bar
 * ago (`Close[1]`), `offset: N` = N bars ago. Negative offsets ("future"
 * offsets, e.g. Pine/MQL's `Close[-1]` construct) are structurally
 * rejected by `validateSeriesOffset` below — never silently clamped to 0
 * or otherwise coerced into something executable.
 */
export interface SeriesOffsetRef {
  readonly series: PriceSeriesField | ReservedPriceSeriesField;
  readonly offset: number;
}

export function seriesOffset(series: PriceSeriesField | ReservedPriceSeriesField, offset: number): SeriesOffsetRef {
  return { series, offset };
}

/**
 * Q0.7.9 — rejects any negative (future) offset. A source construct that
 * literally reads a future offset (e.g. a raw transcription of `Close[-1]`)
 * must be represented as an UnsupportedSemantic record instead of a
 * SeriesOffsetRef — this function is the structural gate that makes that
 * non-optional.
 */
export function validateSeriesOffset(ref: SeriesOffsetRef): boolean {
  return Number.isInteger(ref.offset) && ref.offset >= 0;
}
