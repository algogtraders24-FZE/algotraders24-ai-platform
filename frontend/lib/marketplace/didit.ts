// lib/marketplace/didit.ts
// (Pure - no I/O. Safe for scripts/validate-seller-identity.ts.)
// Didit identity provider (free tier: 500 full KYC checks a month, no minimum - checked on didit.me/pricing 2026-10-09).
// Same product flow as Sumsub: hosted link -> signed webhook -> we store only the verdict. Docs used:
//   create session : POST https://verification.didit.me/v3/session/   header x-api-key   body { workflow_id, vendor_data, callback, ... }  -> { session_id, url }
//   webhook        : headers X-Signature (HMAC-SHA256 hex of the RAW body), X-Signature-V2 (HMAC of canonical JSON: keys sorted, compact),
//                    X-Timestamp (reject if more than 300 s off). Payload { webhook_type: "status.updated", session_id, status, vendor_data, ... }
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ReviewVerdict } from "@/lib/marketplace/identity";

export const DIDIT_SESSION_URL = "https://verification.didit.me/v3/session/";
export const DIDIT_TIMESTAMP_TOLERANCE_SECONDS = 300;

export function diditConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!(env.DIDIT_API_KEY && env.DIDIT_WORKFLOW_ID && env.DIDIT_WEBHOOK_SECRET);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = sortKeys((v as Record<string, unknown>)[k]);
      return acc;
    }, {});
  }
  return v;
}

/** Canonical JSON used by X-Signature-V2: keys sorted at every level, compact separators, unicode kept. */
export function canonicalJson(parsed: unknown): string {
  return JSON.stringify(sortKeys(parsed));
}

function safeEqualHex(expectedHex: string, givenHex: string | null): boolean {
  if (!givenHex) return false;
  const a = Buffer.from(expectedHex);
  const b = Buffer.from(givenHex.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verifies a Didit webhook. Accepts X-Signature-V2 (preferred) or X-Signature (raw body); the deprecated X-Signature-Simple is NOT
 * accepted because it does not cover the decision. The timestamp must be within 5 minutes (replay protection).
 */
export function verifyDiditWebhook(
  rawBody: string,
  headers: { signature: string | null; signatureV2: string | null; timestamp: string | null },
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret) return false;
  const ts = Number.parseInt(headers.timestamp ?? "", 10);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > DIDIT_TIMESTAMP_TOLERANCE_SECONDS) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined && headers.signatureV2) {
    const v2 = createHmac("sha256", secret).update(canonicalJson(parsed), "utf8").digest("hex");
    if (safeEqualHex(v2, headers.signatureV2)) return true;
  }
  if (headers.signature) {
    const raw = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    if (safeEqualHex(raw, headers.signature)) return true;
  }
  return false;
}

/**
 * Verdict from a Didit webhook, or null when it is not a finished decision. `vendor_data` is OUR user id (we set it when creating
 * the session). Approved -> VERIFIED; Declined -> RETRY (the seller may start a new session). "In Review" / "Abandoned" / "Expired"
 * change nothing: the seller stays PENDING and can reopen the link.
 */
export function diditVerdict(payload: unknown): ReviewVerdict | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.webhook_type !== "status.updated") return null;
  const userId = typeof p.vendor_data === "string" ? p.vendor_data : "";
  if (!userId) return null;
  const applicantId = typeof p.session_id === "string" ? p.session_id : null;
  if (p.status === "Approved") return { userId, applicantId, status: "VERIFIED", rejectType: null };
  if (p.status === "Declined") return { userId, applicantId, status: "RETRY", rejectType: "RETRY" };
  return null;
}
