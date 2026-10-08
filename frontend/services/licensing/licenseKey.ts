// services/licensing/licenseKey.ts
// The ONE-string licence key (simple licensing): "AT24-<licenseId>.<apiKey>".
// A buyer pastes this single value into the EA; the runtime sends just it (plus the trading account number) to
// POST /api/license/check. It is only a presentation of the two credentials that already exist - the licence id (public
// identifier) and the raw API key (secret, stored only as a hash) - so nothing new is stored and the old 8-field
// activate/validate endpoints keep working untouched. Pure functions: safe to import anywhere, unit-tested offline.
export const LICENSE_KEY_PREFIX = "AT24-";

export function composeLicenseKey(licenseId: string, rawApiKey: string): string {
  return `${LICENSE_KEY_PREFIX}${licenseId}.${rawApiKey}`;
}

export interface ParsedLicenseKey {
  licenseId: string;
  rawApiKey: string;
}

/** Null for anything that is not exactly "AT24-<licenseId>.<apiKey>" with sane characters/lengths. Never throws. */
export function parseLicenseKey(key: unknown): ParsedLicenseKey | null {
  if (typeof key !== "string") return null;
  const k = key.trim();
  if (k.length < 20 || k.length > 400 || !k.startsWith(LICENSE_KEY_PREFIX)) return null;
  const body = k.slice(LICENSE_KEY_PREFIX.length);
  const dot = body.indexOf(".");
  if (dot <= 0 || dot === body.length - 1 || body.indexOf(".", dot + 1) !== -1) return null;
  const licenseId = body.slice(0, dot);
  const rawApiKey = body.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]{4,120}$/.test(licenseId) || !/^[A-Za-z0-9_-]{16,200}$/.test(rawApiKey)) return null;
  return { licenseId, rawApiKey };
}

export type LicenseCheckReason =
  | "INVALID_KEY"
  | "LICENSE_REVOKED"
  | "LICENSE_SUSPENDED"
  | "LICENSE_EXPIRED"
  | "LICENSE_NOT_USABLE"
  | "RELEASE_REVOKED"
  | "ACCOUNT_REQUIRED"
  | "ACCOUNT_LIMIT_REACHED"
  | "BAD_REQUEST";

/** Account numbers are kept as short plain strings (MT4/MT5 logins, cTrader ids, ...). */
export function cleanAccount(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  if (typeof v !== "string") return "";
  const s = v.trim();
  return /^[A-Za-z0-9._@-]{1,64}$/.test(s) ? s : "";
}

export function cleanServer(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return /^[A-Za-z0-9._ -]{1,64}$/.test(s) ? s : "";
}
