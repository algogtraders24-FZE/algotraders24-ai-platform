// types/publishing/error-contract.ts
// AT24 Publishing Contract - Provider-neutral publish error (Sprint P2.1 §13, §14).
//
// A DestinationAdapter reports failure ONLY through this shape. It never
// leaks a provider SDK error object, an HTTP Response, a stack trace, or -
// critically - a secret (Sprint P2.1 §6, §13). The taxonomy is deliberately
// small: just enough for the Publishing Service to make a safe retry
// decision later (P2.3), not a full HTTP-status mirror.

import { type ContractViolation, contractResult, type ContractValidationResult, isNonEmptyString } from "./common";
import { isPublishingDestinationId, type PublishingDestinationId } from "./destination-contract";

export type PublishErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "RATE_LIMITED"
  | "TEMPORARY_FAILURE"
  | "PERMANENT_FAILURE"
  | "DUPLICATE"
  | "UNKNOWN";

export const PUBLISH_ERROR_CODES: readonly PublishErrorCode[] = [
  "VALIDATION_ERROR",
  "AUTHENTICATION_ERROR",
  "AUTHORIZATION_ERROR",
  "RATE_LIMITED",
  "TEMPORARY_FAILURE",
  "PERMANENT_FAILURE",
  "DUPLICATE",
  "UNKNOWN",
] as const;

/**
 * How the Publishing Service should treat an error of a given code.
 *
 *  - RETRYABLE           - a later automatic attempt MAY succeed unchanged.
 *  - NON_RETRYABLE       - retrying the same input is pointless; needs a
 *                          content fix, a credential fix, or manual action.
 *  - IDEMPOTENT_DUPLICATE - the destination already has this exact content
 *                          version. This is a SUCCESS condition for
 *                          idempotency purposes, not a failure to retry
 *                          (Sprint P2.1 §14). The service should reconcile
 *                          to the existing publication, not create another.
 */
export type PublishRetryClass = "RETRYABLE" | "NON_RETRYABLE" | "IDEMPOTENT_DUPLICATE";

export const PUBLISH_ERROR_RETRY_CLASS: Readonly<Record<PublishErrorCode, PublishRetryClass>> = {
  VALIDATION_ERROR: "NON_RETRYABLE",
  AUTHENTICATION_ERROR: "NON_RETRYABLE",
  AUTHORIZATION_ERROR: "NON_RETRYABLE",
  RATE_LIMITED: "RETRYABLE",
  TEMPORARY_FAILURE: "RETRYABLE",
  PERMANENT_FAILURE: "NON_RETRYABLE",
  DUPLICATE: "IDEMPOTENT_DUPLICATE",
  UNKNOWN: "NON_RETRYABLE", // conservative: an error we cannot classify is not auto-retried
} as const;

export const RETRYABLE_PUBLISH_ERROR_CODES: readonly PublishErrorCode[] = PUBLISH_ERROR_CODES.filter(
  (code) => PUBLISH_ERROR_RETRY_CLASS[code] === "RETRYABLE",
);

/** The provider-neutral failure a `DestinationAdapter.publish()` rejects with,
 *  and the Publishing Service persists on a PublishingJob / PublishingAttempt. */
export interface PublishError {
  code: PublishErrorCode;
  /** Human-readable, safe to log and surface to the owner. MUST NOT contain a
   *  token, password, cookie, signed URL, or any other secret (Sprint P2.1 §13). */
  message: string;
  /** Which destination produced it, when known. */
  destination?: PublishingDestinationId | null;
  /** Derived from `code` via PUBLISH_ERROR_RETRY_CLASS, stored explicitly so an
   *  audit row is self-describing without re-deriving. */
  retryClass: PublishRetryClass;
  /** Optional safe upstream detail (e.g. "HTTP 503", "quota window 60s"). Never
   *  a raw provider payload. */
  cause?: string | null;
}

export function isPublishErrorCode(value: unknown): value is PublishErrorCode {
  return typeof value === "string" && (PUBLISH_ERROR_CODES as readonly string[]).includes(value);
}

export function retryClassFor(code: PublishErrorCode): PublishRetryClass {
  return PUBLISH_ERROR_RETRY_CLASS[code];
}

export function isRetryablePublishErrorCode(code: PublishErrorCode): boolean {
  return PUBLISH_ERROR_RETRY_CLASS[code] === "RETRYABLE";
}

export function isDuplicatePublishError(err: Pick<PublishError, "code">): boolean {
  return err.code === "DUPLICATE";
}

/** The one constructor for a PublishError - keeps `retryClass` always
 *  consistent with `code`. */
export function makePublishError(
  code: PublishErrorCode,
  message: string,
  opts: { destination?: PublishingDestinationId | null; cause?: string | null } = {},
): PublishError {
  return {
    code,
    message,
    destination: opts.destination ?? null,
    retryClass: PUBLISH_ERROR_RETRY_CLASS[code],
    cause: opts.cause ?? null,
  };
}

export function isPublishError(value: unknown): value is PublishError {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    isPublishErrorCode(e.code) &&
    isNonEmptyString(e.message) &&
    (e.destination === undefined || e.destination === null || isPublishingDestinationId(e.destination)) &&
    e.retryClass === PUBLISH_ERROR_RETRY_CLASS[e.code as PublishErrorCode] &&
    (e.cause === undefined || e.cause === null || typeof e.cause === "string")
  );
}

export function validatePublishError(value: unknown): ContractValidationResult {
  const v: ContractViolation[] = [];
  if (!value || typeof value !== "object") {
    return contractResult([{ path: "", message: "PublishError must be an object." }]);
  }
  const e = value as Record<string, unknown>;
  if (!isPublishErrorCode(e.code)) {
    v.push({ path: "code", message: `code must be one of: ${PUBLISH_ERROR_CODES.join(", ")}.` });
  }
  if (!isNonEmptyString(e.message)) {
    v.push({ path: "message", message: "message is required." });
  }
  if (e.destination !== undefined && e.destination !== null && !isPublishingDestinationId(e.destination)) {
    v.push({ path: "destination", message: "destination must be a known PublishingDestinationId or null." });
  }
  if (isPublishErrorCode(e.code) && e.retryClass !== PUBLISH_ERROR_RETRY_CLASS[e.code]) {
    v.push({
      path: "retryClass",
      message: `retryClass must be "${PUBLISH_ERROR_RETRY_CLASS[e.code]}" for code "${e.code}".`,
    });
  }
  if (e.cause !== undefined && e.cause !== null && typeof e.cause !== "string") {
    v.push({ path: "cause", message: "cause must be a string or null." });
  }
  return contractResult(v);
}
