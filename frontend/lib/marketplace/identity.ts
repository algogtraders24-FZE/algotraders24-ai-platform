// lib/marketplace/identity.ts
// (Pure - no I/O. Safe for scripts/validate-seller-identity.ts.)
// Seller identity verification through Sumsub (owner decision 2026-10-09). Sumsub hosts the ID + selfie capture and keeps the
// documents; we send the seller to a hosted link, and receive a signed webhook with the verdict. Docs used:
//   request signing  : HMAC-SHA256 over  ts + METHOD + path(with query) + body , hex, headers X-App-Token / X-App-Access-Sig / X-App-Access-Ts
//   hosted link      : POST /resources/sdkIntegrations/levels/-/websdkLink  body { levelName, ttlInSecs, userId, redirect:{successUrl} }
//   webhook signature: HMAC (alg named in X-Payload-Digest-Alg) over the RAW body, hex, compared to x-payload-digest
import { createHmac, timingSafeEqual } from "node:crypto";

export const SUMSUB_BASE_URL = "https://api.sumsub.com";
export const DEFAULT_LEVEL_NAME = "basic-kyc-level";

export type IdentityStatus = "NONE" | "PENDING" | "VERIFIED" | "REJECTED" | "RETRY";

/** Identity is only enforced when the owner turns it on (after the Sumsub account + keys exist). */
export function identityRequired(raw: string | undefined | null = process.env.SELLER_IDENTITY_REQUIRED): boolean {
  return (raw ?? "").trim().toLowerCase() === "true";
}

export function sumsubConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!(env.SUMSUB_APP_TOKEN && env.SUMSUB_SECRET_KEY && env.SUMSUB_WEBHOOK_SECRET);
}

export function signSumsubRequest(secretKey: string, ts: string, method: string, pathWithQuery: string, body: string): string {
  return createHmac("sha256", secretKey).update(ts + method.toUpperCase() + pathWithQuery + body).digest("hex");
}

const ALGOS: Record<string, string> = { HMAC_SHA256_HEX: "sha256", HMAC_SHA512_HEX: "sha512", HMAC_SHA1_HEX: "sha1" };

/** Constant-time check of a Sumsub webhook against the RAW request body. SHA1 (legacy) is refused. */
export function verifyWebhookSignature(rawBody: string, digestHeader: string | null, algHeader: string | null, secret: string): boolean {
  if (!secret || !digestHeader) return false;
  const algo = ALGOS[(algHeader ?? "").trim().toUpperCase()];
  if (!algo || algo === "sha1") return false;
  const expected = Buffer.from(createHmac(algo, secret).update(rawBody).digest("hex"));
  const given = Buffer.from(digestHeader.trim().toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface ReviewVerdict {
  userId: string;
  applicantId: string | null;
  status: "VERIFIED" | "REJECTED" | "RETRY";
  rejectType: "FINAL" | "RETRY" | null;
}

/**
 * Turns a webhook payload into a verdict, or null when the event is not a finished review (we only act on `applicantReviewed`).
 * `externalUserId` is OUR user id (we set it when creating the link), never something the seller can choose.
 */
export function verdictFromWebhook(payload: unknown): ReviewVerdict | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== "applicantReviewed") return null;
  if (p.reviewStatus !== undefined && p.reviewStatus !== "completed") return null;
  const userId = typeof p.externalUserId === "string" ? p.externalUserId : "";
  if (!userId) return null;
  const result = (p.reviewResult && typeof p.reviewResult === "object" ? p.reviewResult : {}) as Record<string, unknown>;
  const applicantId = typeof p.applicantId === "string" ? p.applicantId : null;
  if (result.reviewAnswer === "GREEN") return { userId, applicantId, status: "VERIFIED", rejectType: null };
  if (result.reviewAnswer === "RED") {
    const t = result.reviewRejectType === "FINAL" ? "FINAL" : "RETRY";
    return { userId, applicantId, status: t === "FINAL" ? "REJECTED" : "RETRY", rejectType: t };
  }
  return null;
}

/** What the seller sees for each state. */
export function identityMessage(status: IdentityStatus): string {
  switch (status) {
    case "VERIFIED": return "Your identity is verified.";
    case "PENDING": return "Your verification is being reviewed. This usually takes a few minutes; refresh this page afterwards.";
    case "RETRY": return "The verification did not pass, but you can try again with a clearer photo of your ID.";
    case "REJECTED": return "Your identity could not be verified. Please contact support.";
    default: return "Verify your identity to list products: a one-time check of an ID document and a selfie, done by our verification partner Sumsub. AT24 never sees or stores your document, only the result.";
  }
}
