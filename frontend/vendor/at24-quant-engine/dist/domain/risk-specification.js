import { ok, fail, combine } from "./validation-result.js";
export function validatePositionSizingMethod(sizing) {
    switch (sizing.method) {
        case "fixed-quantity":
            return sizing.quantity > 0 ? ok() : fail("fixed-quantity: quantity must be > 0");
        case "fixed-lot":
            return sizing.lots > 0 ? ok() : fail("fixed-lot: lots must be > 0");
        case "percent-equity-risk":
            return sizing.percent > 0 && sizing.percent <= 100
                ? ok()
                : fail("percent-equity-risk: percent must be in (0, 100]");
        case "atr-based":
            return combine(sizing.atrMultiple > 0 ? ok() : fail("atr-based: atrMultiple must be > 0"), sizing.atrPeriod > 0 ? ok() : fail("atr-based: atrPeriod must be > 0"));
    }
}
export function validateDistanceSpec(spec, path) {
    switch (spec.mode) {
        case "absolute":
        case "percentage":
            return spec.value > 0 ? ok() : fail(`${path}: value must be > 0`);
        case "atr-multiple":
            return combine(spec.atrMultiple > 0 ? ok() : fail(`${path}: atrMultiple must be > 0`), spec.atrPeriod > 0 ? ok() : fail(`${path}: atrPeriod must be > 0`));
    }
}
/**
 * Q0.10 fix — `BreakevenRule.lockOffset`'s own field doc has always said
 * "absolute value 0 = exactly at entry", a documented, meaningful case
 * (move the stop to break-even with no locked profit). `validateDistanceSpec`
 * rejects `value === 0` unconditionally for every one of its seven call
 * sites, which was correct for all the others (a zero trigger/activation/
 * trailing-distance/partial-close-trigger is degenerate) but silently
 * contradicted lockOffset's own contract — nothing previously exercised
 * this combination (see docs/Q0.10_POSITION_MANAGEMENT_AUDIT.md). This is
 * `lockOffset`-only: every other DistanceSpec use site keeps the strict
 * `value > 0` rule via `validateDistanceSpec`, unchanged.
 */
function validateBreakevenLockOffset(spec, path) {
    switch (spec.mode) {
        case "absolute":
        case "percentage":
            return spec.value >= 0 ? ok() : fail(`${path}: value must be >= 0`);
        case "atr-multiple":
            return validateDistanceSpec(spec, path);
    }
}
function validateSessionWindow(w, path) {
    const results = [];
    const inHourRange = (h) => h >= 0 && h <= 23;
    const inMinuteRange = (m) => m >= 0 && m <= 59;
    if (!inHourRange(w.startHour) || !inHourRange(w.endHour))
        results.push(fail(`${path}: hours must be 0-23`));
    if (!inMinuteRange(w.startMinute) || !inMinuteRange(w.endMinute)) {
        results.push(fail(`${path}: minutes must be 0-59`));
    }
    const startTotal = w.startHour * 60 + w.startMinute;
    const endTotal = w.endHour * 60 + w.endMinute;
    if (results.length === 0 && startTotal >= endTotal) {
        results.push(fail(`${path}: start must be before end`));
    }
    return combine(...results);
}
export function validateRiskSpecification(spec) {
    const results = [validatePositionSizingMethod(spec.sizing)];
    if (spec.maxPositionSize !== undefined && spec.maxPositionSize <= 0) {
        results.push(fail("maxPositionSize must be > 0"));
    }
    if (spec.maxExposure !== undefined && spec.maxExposure <= 0) {
        results.push(fail("maxExposure must be > 0"));
    }
    if (spec.stopLoss?.type === "fixed-distance" && spec.stopLoss.distance <= 0) {
        results.push(fail("stopLoss.distance must be > 0"));
    }
    if (spec.stopLoss?.type === "atr-multiple") {
        if (spec.stopLoss.atrMultiple <= 0)
            results.push(fail("stopLoss.atrMultiple must be > 0"));
        if (spec.stopLoss.atrPeriod <= 0)
            results.push(fail("stopLoss.atrPeriod must be > 0"));
    }
    if (spec.takeProfit?.type === "fixed-distance" && spec.takeProfit.distance <= 0) {
        results.push(fail("takeProfit.distance must be > 0"));
    }
    if (spec.takeProfit?.type === "risk-multiple" && spec.takeProfit.rMultiple <= 0) {
        results.push(fail("takeProfit.rMultiple must be > 0"));
    }
    if (spec.breakeven) {
        results.push(validateDistanceSpec(spec.breakeven.trigger, "breakeven.trigger"));
        results.push(validateBreakevenLockOffset(spec.breakeven.lockOffset, "breakeven.lockOffset"));
    }
    if (spec.trailingStop) {
        results.push(validateDistanceSpec(spec.trailingStop.activation, "trailingStop.activation"));
        results.push(validateDistanceSpec(spec.trailingStop.distance, "trailingStop.distance"));
    }
    if (spec.partialClose) {
        results.push(validateDistanceSpec(spec.partialClose.trigger, "partialClose.trigger"));
        results.push(spec.partialClose.closePercent > 0 && spec.partialClose.closePercent <= 100
            ? ok()
            : fail("partialClose.closePercent must be in (0, 100]"));
    }
    if (spec.sessionHours) {
        if (spec.sessionHours.windows.length === 0) {
            results.push(fail("sessionHours.windows must contain at least one window"));
        }
        spec.sessionHours.windows.forEach((w, i) => {
            results.push(validateSessionWindow(w, `sessionHours.windows[${i}]`));
        });
    }
    if (spec.maxHoldingPeriod) {
        const { maxBars, maxDurationMs } = spec.maxHoldingPeriod;
        if (maxBars === undefined && maxDurationMs === undefined) {
            results.push(fail("maxHoldingPeriod: at least one of maxBars/maxDurationMs must be set"));
        }
        if (maxBars !== undefined && maxBars <= 0)
            results.push(fail("maxHoldingPeriod.maxBars must be > 0"));
        if (maxDurationMs !== undefined && maxDurationMs <= 0) {
            results.push(fail("maxHoldingPeriod.maxDurationMs must be > 0"));
        }
    }
    if (spec.maxSimultaneousPositions !== undefined && spec.maxSimultaneousPositions <= 0) {
        results.push(fail("maxSimultaneousPositions must be > 0"));
    }
    if (spec.dailyLossLimit) {
        if (spec.dailyLossLimit.mode === "percent-equity") {
            results.push(spec.dailyLossLimit.percent > 0 && spec.dailyLossLimit.percent <= 100
                ? ok()
                : fail("dailyLossLimit.percent must be in (0, 100]"));
        }
        else {
            results.push(spec.dailyLossLimit.amount > 0 ? ok() : fail("dailyLossLimit.amount must be > 0"));
        }
    }
    return combine(...results);
}
