// types/publishing/job-contract.ts
// AT24 Publishing Contract - PublishingJob + PublishingJobStatus (Sprint P2.1 §3, §5).
//
// A PublishingJob is the LOGICAL publishing operation: "publish Article X to
// destination D at content version H". It owns lifecycle, idempotency and the
// authorization boundary. Its execution history is a list of PublishingAttempt
// rows (attempt-contract.ts).
//
// ARCHITECTURAL SEPARATION (Sprint P2.1 §3, §4):
//
//     Article lifecycle   (types/article.ts#ArticleStatus)   -- "is the content ready / where is it"
//         !=
//     PublishingJobStatus (this file)                          -- "did the publish operation run"
//         !=
//     PublishingAttemptStatus (attempt-contract.ts)            -- "did ONE execution try succeed"
//         !=
//     Destination         (destination-contract.ts)            -- "where"
//
// The existing ArticleStatus is NOT modified by P2.1 and MUST NOT become the
// job status. The mapping between them is advisory and owned by the Publishing
// Service, not this contract (see ARTICLE_STATUS_ON_JOB_SUCCESS below).

import {
  type ContractViolation,
  type ContractValidationResult,
  contractResult,
  isIsoTimestamp,
  isNonEmptyString,
  isNonNegativeInteger,
  isSha256Hex,
} from "./common";
import { isPublishingDestinationId, type PublishingDestinationId } from "./destination-contract";
import { isPublishError, type PublishError } from "./error-contract";
import { isPublishResult, type PublishResult } from "./result-contract";
import type { ArticleStatus } from "@/types/article";

// ---- Status ------------------------------------------------------------

export type PublishingJobStatus =
  | "PENDING" // accepted, not executing (queued / awaiting its scheduled slot)
  | "RUNNING" // an execution attempt is in progress right now
  | "SUCCEEDED" // a destination confirmed publication (TERMINAL)
  | "FAILED" // an attempt failed; awaiting retry or manual intervention (NON-terminal)
  | "CANCELLED"; // intentionally prevented from executing / abandoned (TERMINAL)

export const PUBLISHING_JOB_STATUSES: readonly PublishingJobStatus[] = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

/**
 * Terminal = no further transitions, ever. A new content version = a new job,
 * never a re-open of this one (mirrors AgentRun's "re-run = new row").
 *
 * FAILED is deliberately NOT terminal: §5 says it "requires retry/manual
 * intervention", and §6's example (attempt 1 FAILED, 2 FAILED, 3 SUCCEEDED)
 * needs the job to stay alive across attempts.
 */
export const TERMINAL_PUBLISHING_JOB_STATUSES: readonly PublishingJobStatus[] = [
  "SUCCEEDED",
  "CANCELLED",
] as const;

/** The ONLY permitted status transitions. Any (from -> to) not listed is
 *  rejected by isValidJobTransition(). */
export const PUBLISHING_JOB_STATUS_TRANSITIONS: Readonly<
  Record<PublishingJobStatus, readonly PublishingJobStatus[]>
> = {
  PENDING: ["RUNNING", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "FAILED", "CANCELLED"],
  FAILED: ["PENDING", "RUNNING", "CANCELLED"], // retry re-queues (PENDING) or re-executes (RUNNING); give up = CANCELLED
  SUCCEEDED: [],
  CANCELLED: [],
} as const;

export function isPublishingJobStatus(value: unknown): value is PublishingJobStatus {
  return typeof value === "string" && (PUBLISHING_JOB_STATUSES as readonly string[]).includes(value);
}

export function isTerminalPublishingJobStatus(status: PublishingJobStatus): boolean {
  return (TERMINAL_PUBLISHING_JOB_STATUSES as readonly string[]).includes(status);
}

export function isValidJobTransition(from: PublishingJobStatus, to: PublishingJobStatus): boolean {
  if (!isPublishingJobStatus(from) || !isPublishingJobStatus(to)) return false;
  return (PUBLISHING_JOB_STATUS_TRANSITIONS[from] as readonly string[]).includes(to);
}

export function validateJobTransition(
  from: PublishingJobStatus,
  to: PublishingJobStatus,
): ContractValidationResult {
  if (!isPublishingJobStatus(from)) {
    return contractResult([{ path: "from", message: `Unknown job status "${String(from)}".` }]);
  }
  if (!isPublishingJobStatus(to)) {
    return contractResult([{ path: "to", message: `Unknown job status "${String(to)}".` }]);
  }
  if (isTerminalPublishingJobStatus(from)) {
    return contractResult([
      { path: "from", message: `"${from}" is terminal - a new content version is a new job, not a re-open.` },
    ]);
  }
  if (!isValidJobTransition(from, to)) {
    return contractResult([{ path: "to", message: `Transition "${from}" -> "${to}" is not permitted.` }]);
  }
  return contractResult([]);
}

// ---- Relationship to ArticleStatus (advisory - Sprint P2.1 §4) ---------

/**
 * ADVISORY ONLY. When a job reaches SUCCEEDED for a website-facing
 * destination, the Publishing Service MAY move the Article to this status.
 * P2.1 does not perform this; it documents the intended coupling so P2.2/P2.3
 * implement it in one place. `null` = "leave ArticleStatus untouched".
 *
 * Note ArticleStatus is lowercase (existing, unchanged); PublishingJobStatus
 * is UPPERCASE (this contract, matching the marketplace publishing vocabulary).
 * The case difference is intentional and makes cross-referencing unambiguous.
 */
export const ARTICLE_STATUS_ON_JOB_SUCCESS: Readonly<
  Record<PublishingJobStatus, ArticleStatus | null>
> = {
  PENDING: null,
  RUNNING: null,
  SUCCEEDED: "published",
  FAILED: "failed",
  CANCELLED: null,
} as const;

// ---- The job row ------------------------------------------------------

export interface PublishingJob {
  id: string;
  /** SOURCE identity - the Article being published. */
  articleId: string;
  /** Owner of the Article. Carried on the job so the Publishing Service can
   *  enforce ownership ABOVE the adapter boundary (Sprint P2.1 §15). Set from
   *  the server session, never from a request body. */
  userId: string;
  destination: PublishingDestinationId;
  status: PublishingJobStatus;
  /** The content version this job publishes (publish-input-contract.ts). */
  contentHash: string;
  /** = publicationIdentityKey({ articleId, destination, contentHash }). The
   *  value a future unique index / upsert enforces (Sprint P2.1 §11, §19). */
  idempotencyKey: string;
  /** When the job was accepted. */
  requestedAt: string;
  /** Set only by a future scheduling sub-sprint (P2.4). Null = publish as soon
   *  as a dispatcher picks it up. A preset slot time, never a free clock -
   *  Vercel Hobby constraint (P1 audit R1). */
  scheduledFor?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  /** Count of PublishingAttempt rows made so far. */
  attemptCount: number;
  /** The most recent failure, if the job is FAILED. Cleared on SUCCEEDED. */
  lastError?: PublishError | null;
  /** The confirmed result, once SUCCEEDED. */
  result?: PublishResult | null;
  createdAt: string;
  updatedAt: string;
}

export function isPublishingJob(value: unknown): value is PublishingJob {
  if (!value || typeof value !== "object") return false;
  const j = value as Record<string, unknown>;
  return (
    isNonEmptyString(j.id) &&
    isNonEmptyString(j.articleId) &&
    isNonEmptyString(j.userId) &&
    isPublishingDestinationId(j.destination) &&
    isPublishingJobStatus(j.status) &&
    isSha256Hex(j.contentHash) &&
    isNonEmptyString(j.idempotencyKey) &&
    isIsoTimestamp(j.requestedAt) &&
    isNonNegativeInteger(j.attemptCount) &&
    isIsoTimestamp(j.createdAt) &&
    isIsoTimestamp(j.updatedAt)
  );
}

export function validatePublishingJob(value: unknown): ContractValidationResult {
  const v: ContractViolation[] = [];
  if (!value || typeof value !== "object") {
    return contractResult([{ path: "", message: "PublishingJob must be an object." }]);
  }
  const j = value as Record<string, unknown>;
  if (!isNonEmptyString(j.id)) v.push({ path: "id", message: "id is required." });
  if (!isNonEmptyString(j.articleId)) v.push({ path: "articleId", message: "articleId is required." });
  if (!isNonEmptyString(j.userId)) v.push({ path: "userId", message: "userId is required (ownership boundary)." });
  if (!isPublishingDestinationId(j.destination)) {
    v.push({ path: "destination", message: "destination must be a known PublishingDestinationId." });
  }
  if (!isPublishingJobStatus(j.status)) {
    v.push({ path: "status", message: `status must be one of: ${PUBLISHING_JOB_STATUSES.join(", ")}.` });
  }
  if (!isSha256Hex(j.contentHash)) {
    v.push({ path: "contentHash", message: "contentHash must be a 64-char lowercase sha256 hex string." });
  }
  if (!isNonEmptyString(j.idempotencyKey)) {
    v.push({ path: "idempotencyKey", message: "idempotencyKey is required." });
  }
  if (!isIsoTimestamp(j.requestedAt)) v.push({ path: "requestedAt", message: "requestedAt must be ISO-8601." });
  if (j.scheduledFor !== undefined && j.scheduledFor !== null && !isIsoTimestamp(j.scheduledFor)) {
    v.push({ path: "scheduledFor", message: "scheduledFor must be an ISO-8601 timestamp or null." });
  }
  if (j.startedAt !== undefined && j.startedAt !== null && !isIsoTimestamp(j.startedAt)) {
    v.push({ path: "startedAt", message: "startedAt must be an ISO-8601 timestamp or null." });
  }
  if (j.completedAt !== undefined && j.completedAt !== null && !isIsoTimestamp(j.completedAt)) {
    v.push({ path: "completedAt", message: "completedAt must be an ISO-8601 timestamp or null." });
  }
  if (!isNonNegativeInteger(j.attemptCount)) {
    v.push({ path: "attemptCount", message: "attemptCount must be an integer >= 0." });
  }
  if (j.lastError !== undefined && j.lastError !== null && !isPublishError(j.lastError)) {
    v.push({ path: "lastError", message: "lastError must be a valid PublishError or null." });
  }
  if (j.result !== undefined && j.result !== null && !isPublishResult(j.result)) {
    v.push({ path: "result", message: "result must be a valid PublishResult or null." });
  }
  // Cross-field: a SUCCEEDED job must carry a result; a terminal SUCCEEDED job
  // must not still carry a lastError.
  if (j.status === "SUCCEEDED" && !isPublishResult(j.result)) {
    v.push({ path: "result", message: "a SUCCEEDED job must carry a PublishResult." });
  }
  if (j.status === "FAILED" && !isPublishError(j.lastError)) {
    v.push({ path: "lastError", message: "a FAILED job must carry a PublishError." });
  }
  return contractResult(v);
}
