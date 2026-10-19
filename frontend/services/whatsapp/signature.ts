// services/whatsapp/signature.ts
// Meta signs every webhook POST: header X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(rawBody, appSecret). The raw body
// string must be used (not re-serialised JSON). Compared in constant time.
import { createHmac, timingSafeEqual } from "node:crypto";

export function signBody(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

export function signatureValid(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || appSecret.length === 0) return false;
  const expected = Buffer.from(signBody(rawBody, appSecret), "utf8");
  const given = Buffer.from(header.trim(), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The one-time GET handshake when the owner saves the webhook in Meta's console. */
export function verifyHandshake(params: URLSearchParams, verifyToken: string): string | null {
  if (verifyToken.length === 0) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  const given = Buffer.from(params.get("hub.verify_token") ?? "", "utf8");
  const wanted = Buffer.from(verifyToken, "utf8");
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  return params.get("hub.challenge");
}
