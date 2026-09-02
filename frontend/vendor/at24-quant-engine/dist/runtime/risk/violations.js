export function makeViolation(code, severity, message, relevantValue, configuredLimit, reason) {
    return { code, severity, message, relevantValue, configuredLimit, reason };
}
