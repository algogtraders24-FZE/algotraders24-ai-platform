export function diagnostic(code, message, severity, position) {
    return { code, message, severity, ...(position !== undefined ? { position } : {}) };
}
