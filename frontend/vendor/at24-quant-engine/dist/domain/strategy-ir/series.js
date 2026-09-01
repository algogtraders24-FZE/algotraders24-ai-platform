export function seriesOffset(series, offset) {
    return { series, offset };
}
/**
 * Q0.7.9 — rejects any negative (future) offset. A source construct that
 * literally reads a future offset (e.g. a raw transcription of `Close[-1]`)
 * must be represented as an UnsupportedSemantic record instead of a
 * SeriesOffsetRef — this function is the structural gate that makes that
 * non-optional.
 */
export function validateSeriesOffset(ref) {
    return Number.isInteger(ref.offset) && ref.offset >= 0;
}
