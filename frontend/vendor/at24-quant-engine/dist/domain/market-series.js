import { ok, fail, combine } from "./validation-result.js";
/**
 * Checks chronological ordering (strictly increasing timestamps),
 * duplicate timestamps, per-bar instrument/timeframe consistency with the
 * series, and OHLC validity (high >= low, open/close within [low, high],
 * volume >= 0).
 */
export function validateMarketSeries(series) {
    const results = [];
    const seenTimestamps = new Set();
    let prevTimestamp = null;
    series.bars.forEach((bar, i) => {
        if (seenTimestamps.has(bar.timestamp)) {
            results.push(fail(`bars[${i}]: duplicate timestamp ${bar.timestamp}`));
        }
        seenTimestamps.add(bar.timestamp);
        if (prevTimestamp !== null && bar.timestamp <= prevTimestamp) {
            results.push(fail(`bars[${i}]: timestamp ${bar.timestamp} is not strictly after previous ${prevTimestamp} (chronological order violated)`));
        }
        prevTimestamp = bar.timestamp;
        if (bar.instrument.symbol !== series.instrument.symbol) {
            results.push(fail(`bars[${i}]: instrument "${bar.instrument.symbol}" does not match series instrument "${series.instrument.symbol}"`));
        }
        if (bar.timeframe !== series.timeframe) {
            results.push(fail(`bars[${i}]: timeframe "${bar.timeframe}" does not match series timeframe "${series.timeframe}"`));
        }
        if (bar.high < bar.low) {
            results.push(fail(`bars[${i}]: high (${bar.high}) < low (${bar.low})`));
        }
        if (bar.open > bar.high || bar.open < bar.low) {
            results.push(fail(`bars[${i}]: open (${bar.open}) outside [low, high] = [${bar.low}, ${bar.high}]`));
        }
        if (bar.close > bar.high || bar.close < bar.low) {
            results.push(fail(`bars[${i}]: close (${bar.close}) outside [low, high] = [${bar.low}, ${bar.high}]`));
        }
        if (bar.volume < 0) {
            results.push(fail(`bars[${i}]: volume (${bar.volume}) must be >= 0`));
        }
    });
    return results.length === 0 ? ok() : combine(...results);
}
/** Deterministic, explicit chronological iteration (bars are assumed pre-validated). */
export function* iterateChronologically(series) {
    for (const bar of series.bars)
        yield bar;
}
/**
 * Informational only — NOT a validation failure. A gap wider than
 * `expectedIntervalMs` may be a legitimate weekend/holiday/session break,
 * not corrupt data, so this is reported for the caller to judge, never
 * thrown from validateMarketSeries().
 */
export function detectTimestampGaps(series, expectedIntervalMs) {
    const gaps = [];
    for (let i = 1; i < series.bars.length; i++) {
        const prev = series.bars[i - 1];
        const curr = series.bars[i];
        const actualIntervalMs = curr.timestamp - prev.timestamp;
        if (actualIntervalMs > expectedIntervalMs) {
            gaps.push({ afterIndex: i - 1, expectedIntervalMs, actualIntervalMs });
        }
    }
    return gaps;
}
