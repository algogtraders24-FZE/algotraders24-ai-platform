// services/licensing/crypto.ts
// Sprint M11 - Cryptographic model (brief section 6). Node's built-in
// `crypto` module only - same convention this codebase already uses for
// webhook signature verification (services/billing/providers/
// NowPaymentsProvider.ts's HMAC + timingSafeEqual). Ed25519 asymmetric
// signing: the PRIVATE key never leaves this server-side module (never
// embedded in an EA binary, never in frontend/client code, never shown to
// a seller or buyer); the PUBLIC key is what a runtime product embeds to
// verify a license payload deterministically, offline, without a live
// server round-trip every check.
import "server-only";
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as cryptoSign, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import type { LicensePayload } from "@/types/marketplace-license";

// Fail closed, never fall back to an insecure default key. A missing key
// is a deployment-configuration error that must be visible immediately,
// not a silent no-signature/unsigned-license path.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set - license signing/verification cannot proceed without a real server-side key. See .env.example.`);
  }
  return value;
}

function loadPrivateKey() {
  const pem = requireEnv("LICENSE_SIGNING_PRIVATE_KEY").replace(/\\n/g, "\n");
  return createPrivateKey({ key: pem, format: "pem" });
}

function loadPublicKey() {
  const pem = requireEnv("LICENSE_SIGNING_PUBLIC_KEY").replace(/\\n/g, "\n");
  return createPublicKey({ key: pem, format: "pem" });
}

// Canonical, deterministic serialization: sorted keys, no whitespace
// ambiguity. The same payload always serializes to the same bytes, so
// verification is deterministic (M11 brief section 6) and a single-field
// tamper is guaranteed to change the signed bytes (section 17).
export function canonicalize(payload: LicensePayload): string {
  const sortedKeys = Object.keys(payload).sort() as (keyof LicensePayload)[];
  const record: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const value = payload[key];
    record[key] = typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value;
  }
  return JSON.stringify(record);
}

export function signLicensePayload(payload: LicensePayload): string {
  const bytes = Buffer.from(canonicalize(payload), "utf-8");
  return cryptoSign(null, bytes, loadPrivateKey()).toString("base64");
}

export function verifyLicenseSignature(payload: LicensePayload, signatureBase64: string): boolean {
  try {
    const bytes = Buffer.from(canonicalize(payload), "utf-8");
    const signature = Buffer.from(signatureBase64, "base64");
    return cryptoVerify(null, bytes, loadPublicKey(), signature);
  } catch {
    // Any malformed signature/payload is a verification failure, never a
    // thrown error that could be mishandled by a caller into an "allow".
    return false;
  }
}

// The credential a RUNTIME product presents to /api/license/* (never a
// browser session - see M11_api_contract.md). Returned to the buyer once,
// at issuance; only the hash is ever persisted (same principle as a
// password: the raw value is not recoverable from storage).
export function generateApiKey(): string {
  return `at24_lic_${randomBytes(32).toString("hex")}`;
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf-8").digest("hex");
}

export function verifyApiKey(rawKey: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashApiKey(rawKey), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
