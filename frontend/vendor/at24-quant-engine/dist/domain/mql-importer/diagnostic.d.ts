import type { SourcePosition } from "./token.js";
/** Q0.8.42 — a strategy may become execution-eligible only when there are ZERO BLOCKING diagnostics. */
export type DiagnosticSeverity = "INFO" | "WARNING" | "BLOCKING";
export interface Diagnostic {
    readonly code: string;
    readonly message: string;
    readonly severity: DiagnosticSeverity;
    readonly position?: SourcePosition;
}
export declare function diagnostic(code: string, message: string, severity: DiagnosticSeverity, position?: SourcePosition): Diagnostic;
