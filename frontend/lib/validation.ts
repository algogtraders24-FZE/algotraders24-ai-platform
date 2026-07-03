export function isRequired(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim().length > 0;
}

export function minLength(value: string, min: number): boolean {
  return value.length >= min;
}

export function maxLength(value: string, max: number): boolean {
  return value.length <= max;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidLicenseKey(key: string): boolean {
  // Format: XXXX-XXXX-XXXX (letters/numbers, hyphen-separated blocks)
  return /^[A-Z0-9]{4}(-[A-Z0-9]{4})+$/.test(key);
}

export function isPositiveNumber(value: number): boolean {
  return typeof value === "number" && !Number.isNaN(value) && value > 0;
}