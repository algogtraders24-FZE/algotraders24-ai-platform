export function isValidated(result) {
    return result.status === "VALIDATED";
}
/**
 * The only sanctioned way to reach status "VALIDATED". Throws if the
 * result is not currently CANDIDATE — a result can never be validated
 * from UNRUN/FAILED/REJECTED, and re-validating an already-VALIDATED
 * result is not a no-op, it's an error (validation is a one-time event
 * a caller must be deliberate about, not something to silently repeat).
 */
export function markValidated(result, validatedAt) {
    if (result.status !== "CANDIDATE") {
        throw new Error(`Cannot mark VALIDATED from status "${result.status}" — only a CANDIDATE result may be validated`);
    }
    return { ...result, status: "VALIDATED", validatedAt };
}
