export interface ValidationResult {
    readonly valid: boolean;
    readonly errors: readonly string[];
}
export declare function ok(): ValidationResult;
export declare function fail(...errors: readonly string[]): ValidationResult;
export declare function combine(...results: readonly ValidationResult[]): ValidationResult;
