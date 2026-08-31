import type { MetricSet } from "./metrics.js";

/**
 * UNRUN: created, not yet executed.
 * COMPLETED: ran to completion, raw metrics available, no judgment applied.
 * FAILED: did not complete (error/crash), see `failureReason`.
 * REJECTED: completed but judged unusable before validation (e.g. failed a
 *   basic sanity check), see `rejectionReason` — distinct from FAILED,
 *   which means it never finished running at all.
 * CANDIDATE: completed and passed basic sanity checks; eligible for a
 *   validation process, but NOT YET validated.
 * VALIDATED: an actual validation process has run and this result is on
 *   the far side of it. Reachable ONLY via `markValidated()`, and only
 *   from CANDIDATE — this is the entire point of the status model: the
 *   string "VALIDATED" may never be assigned as a raw literal in calling
 *   code without going through that transition.
 */
export type ResearchResultStatus = "UNRUN" | "COMPLETED" | "FAILED" | "REJECTED" | "CANDIDATE" | "VALIDATED";

export interface ResearchResult {
  readonly experimentId: string;
  readonly status: ResearchResultStatus;
  readonly metrics?: MetricSet;
  readonly failureReason?: string;
  readonly rejectionReason?: string;
  readonly producedAt: number;
  readonly validatedAt?: number;
}

export function isValidated(result: ResearchResult): boolean {
  return result.status === "VALIDATED";
}

/**
 * The only sanctioned way to reach status "VALIDATED". Throws if the
 * result is not currently CANDIDATE — a result can never be validated
 * from UNRUN/FAILED/REJECTED, and re-validating an already-VALIDATED
 * result is not a no-op, it's an error (validation is a one-time event
 * a caller must be deliberate about, not something to silently repeat).
 */
export function markValidated(result: ResearchResult, validatedAt: number): ResearchResult {
  if (result.status !== "CANDIDATE") {
    throw new Error(`Cannot mark VALIDATED from status "${result.status}" — only a CANDIDATE result may be validated`);
  }
  return { ...result, status: "VALIDATED", validatedAt };
}
