// lib/market-data/angel-one-totp.ts
// Sprint D2.6.3 - RFC 6238 TOTP generation for Angel One SmartAPI login,
// implemented from the published RFC using only Node's built-in `crypto`
// module - no new npm dependency (none of otplib/speakeasy/etc. exist in
// this project's package.json; confirmed before writing this file).
// Pure and deterministic given a real base32 secret and a real point in
// time - no network, no randomness. Verified against RFC 6238 Appendix
// B's own published SHA-1 test vectors (the standard test secret
// "12345678901234567890", base32-encoded) before being trusted for real
// use - see scripts/validate-multi-provider-router.ts.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

/** Decodes a standard (RFC 4648) base32 string, e.g. an Angel One TOTP_SECRET, into raw bytes. Uppercases and strips padding/whitespace first - never guesses at malformed input, throws instead. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: "${char}"`);
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

async function hmacSha1(key: Buffer, message: Buffer): Promise<Buffer> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha1", key).update(message).digest();
}

/**
 * Generates a real RFC 6238 TOTP code for the given base32 secret at the
 * given moment (defaults to the real current time). `secret` is never
 * logged, echoed, or included in any thrown error - the caller is
 * responsible for the same discipline with the returned code.
 */
export async function generateTotp(secret: string, atMs: number = Date.now()): Promise<string> {
  const key = base32Decode(secret);
  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const hmac = await hmacSha1(key, counterBuffer);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const code = binaryCode % 10 ** TOTP_DIGITS;
  return code.toString().padStart(TOTP_DIGITS, "0");
}
