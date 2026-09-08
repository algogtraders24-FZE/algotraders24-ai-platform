// types/publishing/attempt-contract.ts
// AT24 Publishing Contract - PublishingAttempt (Sprint P2.1 §6).
//
// A PublishingJob is the logical operation. A PublishingAttempt is ONE
// execution of it. A job accumulates attempts until it SUCCEEDS or is
// CANCELLED:
//
//     Job #123
//       Attempt #1 -> FAILED   (RATE_LIMITED)
//       Attempt #2 -> FAILED   (TEMPORARY_FAILURE)
//       Attempt #3 -> SUCCEEDED
//
// Attempts are append-only and immutable once terminal - a re-execution is a
// NEW attempt row, never an edit of an old one (mirrors AgentStep / AuditLog
// discipline). No `deletedAt`.

import {
  type ContractViolation,
  type ContractValidationResult,
  contractResult,
  isIsoTimestamp,
  isNonEmptyString,
  isPositiveInteger,
} from "./common";
import { isPublishError, type PublishError } from "./error-contract";

export type PublishingAttemptStatus =
  | "RUNNING" // in progress
  | "SUCCEEDED" // this attempt published successfully (TERMINAL)
  | "FAILED"; // this attempt failed (TERMINAL)

export const PUBLISHING_ATTEMPT_STATUSES: readonly PublishingAttemptStatus[] = [
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;

export const TERMINAL_PUBLISHING_ATTEMPT_STATUSES: readonly PublishingAttemptStatus[] = [
  "SUCCEEDED",
  "FAILED",
] as const;

export const PUBLISHING_ATTEMPT_STATUS_TRANSITIONS: Readonly<
  Record<PublishingAttemptStatus, readonly PublishingAttemptStatus[]>
> = {
  RUNNING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
} as const;

export function isPublishingAttemptStatus(value: unknown): value is PublishingAttemptStatus {
  return typeof value === "string" && (PUBLISHING_ATTEMPT_STATUSES as readonly string[]).includes(value);
}

export function isTerminalPublishingAttemptStatus(status: PublishingAttemptStatus): boolean {
  return (TERMINAL_PUBLISHING_ATTEMPT_STATUSES as readonly string[]).includes(status);
}

export function isValidAttemptTransition(
  from: PublishingAttemptStatus,
  to: PublishingAttemptStatus,
): boolean {
  if (!isPublishingAttemptStatus(from) || !isPublishingAttemptStatus(to)) return false;
  return (PUBLISHING_ATTEMPT_STATUS_TRANSITIONS[from] as readonly string[]).includes(to);
}

export interface PublishingAttempt {
  id: string;
  jobId: string;
  /** 1-based, strictly increasing within a job, gapless. */
  attemptNumber: number;
  status: PublishingAttemptStatus;
  startedAt: string;
  /** Set once the attempt is terminal. */
  completedAt?: string | null;
  /** The failure, when status === "FAILED". */
  error?: PublishError | null;
  /** Destination-issued id, when the attempt succeeded and the destination
   *  supplies one. Null for INTERNAL_BLOG. Never fabricated. */
  externalReference?: string | null;
  /** Public URL of the published item, when known. */
  externalUrl?: string | null;
  /**
   * SAFE, non-secret metadata the destination returned that is worth keeping
   * for debugging / observability (e.g. `{ httpStatus: 201, revision: 4 }`).
   * The adapter is responsible for stripping tokens / signed URLs / PII
   * before it ever reaches this field (Sprint P2.1 §6, §13).
   */
  destinationResponseMeta?: Readonly<Record<string, unknown>> | null;
  /** Append-only row write time. */
  createdAt: string;
}

export function isPublishingAttempt(value: unknown): value is PublishingAttempt {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return (
    isNonEmptyString(a.id) &&
    isNonEmptyString(a.jobId) &&
    isPositiveInteger(a.attemptNumber) &&
    isPublishingAttemptStatus(a.status) &&
    isIsoTimestamp(a.startedAt) &&
    isIsoTimestamp(a.createdAt)
  );
}

export function validatePublishingAttempt(value: unknown): ContractValidationResult {
  const v: ContractViolation[] = [];
  if (!value || typeof value !== "object") {
    return contractResult([{ path: "", message: "PublishingAttempt must be an object." }]);
  }
  const a = value as Record<string, unknown>;
  if (!isNonEmptyString(a.id)) v.push({ path: "id", message: "id is required." });
  if (!isNonEmptyString(a.jobId)) v.push({ path: "jobId", message: "jobId is required." });
  if (!isPositiveInteger(a.attemptNumber)) {
    v.push({ path: "attemptNumber", message: "attemptNumber must be an integer >= 1." });
  }
  if (!isPublishingAttemptStatus(a.status)) {
    v.push({ path: "status", message: `status must be one of: ${PUBLISHING_ATTEMPT_STATUSES.join(", ")}.` });
  }
  if (!isIsoTimestamp(a.startedAt)) v.push({ path: "startedAt", message: "startedAt must be ISO-8601." });
  if (a.completedAt !== undefined && a.completedAt !== null && !isIsoTimestamp(a.completedAt)) {
    v.push({ path: "completedAt", message: "completedAt must be an ISO-8601 timestamp or null." });
  }
  if (a.error !== undefined && a.error !== null && !isPublishError(a.error)) {
    v.push({ path: "error", message: "error must be a valid PublishError or null." });
  }
  if (a.externalReference !== undefined && a.externalReference !== null && typeof a.externalReference !== "string") {
    v.push({ path: "externalReference", message: "externalReference must be a string or null." });
  }
  if (a.externalUrl !== undefined && a.externalUrl !== null && typeof a.externalUrl !== "string") {
    v.push({ path: "externalUrl", message: "externalUrl must be a string or null." });
  }
  if (
    a.destinationResponseMeta !== undefined &&
    a.destinationResponseMeta !== null &&
    (typeof a.destinationResponseMeta !== "object" || Array.isArray(a.destinationResponseMeta))
  ) {
    v.push({ path: "destinationResponseMeta", message: "destinationResponseMeta must be an object or null." });
  }
  // Cross-field rules
  if (isPublishingAttemptStatus(a.status) && isTerminalPublishingAttemptStatus(a.status) && !isIsoTimestamp(a.completedAt)) {
    v.push({ path: "completedAt", message: `a ${String(a.status)} attempt must have completedAt set.` });
  }
  if (a.status === "FAILED" && !isPublishError(a.error)) {
    v.push({ path: "error", message: "a FAILED attempt must carry a PublishError." });
  }
  if (a.status === "RUNNING" && (a.completedAt ?? null) !== null) {
    v.push({ path: "completedAt", message: "a RUNNING attempt must not have completedAt set." });
  }
  return contractResult(v);
}
