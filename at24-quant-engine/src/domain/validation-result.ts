export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

export function fail(...errors: readonly string[]): ValidationResult {
  return { valid: false, errors };
}

export function combine(...results: readonly ValidationResult[]): ValidationResult {
  const errors = results.flatMap((r) => r.errors);
  return errors.length === 0 ? ok() : fail(...errors);
}
