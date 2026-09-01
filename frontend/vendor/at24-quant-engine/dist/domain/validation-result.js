export function ok() {
    return { valid: true, errors: [] };
}
export function fail(...errors) {
    return { valid: false, errors };
}
export function combine(...results) {
    const errors = results.flatMap((r) => r.errors);
    return errors.length === 0 ? ok() : fail(...errors);
}
