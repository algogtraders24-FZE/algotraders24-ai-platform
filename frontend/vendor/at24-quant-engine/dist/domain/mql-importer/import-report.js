export function blockingDiagnostics(report) {
    return report.diagnostics.filter((d) => d.severity === "BLOCKING");
}
