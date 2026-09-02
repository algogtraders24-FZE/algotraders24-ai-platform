import { makeViolation } from "./violations.js";
/**
 * Converts a UTC epoch-ms timestamp to local hour/minute in `timezone`
 * using Intl.DateTimeFormat — deterministic and independent of the host
 * machine's local timezone setting (the conversion depends only on the
 * `timezone` argument and Node's bundled ICU data, never on any
 * environment-variable-based override or the OS clock's zone).
 */
function localHourMinute(timestampMs, timezone) {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
    const parts = formatter.formatToParts(new Date(timestampMs));
    const rawHour = Number(parts.find((p) => p.type === "hour").value);
    const minute = Number(parts.find((p) => p.type === "minute").value);
    return { hour: rawHour % 24, minute }; // Intl with hour12:false can emit "24" for midnight
}
/** Half-open interval [start, end) — the start minute is inside the window, the end minute is not. */
function isWithinWindow(hour, minute, window) {
    const total = hour * 60 + minute;
    const start = window.startHour * 60 + window.startMinute;
    const end = window.endHour * 60 + window.endMinute;
    return total >= start && total < end;
}
export function isWithinAnySessionWindow(timestampMs, session) {
    const { hour, minute } = localHourMinute(timestampMs, session.timezone);
    return session.windows.some((w) => isWithinWindow(hour, minute, w));
}
/**
 * Entry-time-only gate (Q0.2's field doc: "does not affect exits").
 * `SessionHoursRule.windows` cannot itself express a window crossing
 * midnight (Q0.2 constraint: start < end) — an "overnight session" must
 * be expressed as two separate windows by the caller; this is a known,
 * documented limitation carried forward from Q0.2, not something this
 * function works around.
 */
export function evaluateSessionEligibility(spec, asOf) {
    const session = spec.sessionHours;
    if (session === undefined)
        return { passed: true };
    let inWindow;
    try {
        inWindow = isWithinAnySessionWindow(asOf, session);
    }
    catch {
        return {
            passed: false,
            violation: makeViolation("SESSION_RESTRICTION", "BLOCKING", `invalid timezone "${session.timezone}"`, session.timezone, null, "INVALID_CONFIGURATION"),
        };
    }
    if (!inWindow) {
        return {
            passed: false,
            violation: makeViolation("SESSION_RESTRICTION", "BLOCKING", `timestamp ${asOf} is outside all configured session windows (timezone ${session.timezone})`, asOf, null, "OUTSIDE_ALLOWED_WINDOW"),
        };
    }
    return { passed: true };
}
