// types/publishing/adapter-contract.ts
// AT24 Publishing Contract - DestinationAdapter boundary (Sprint P2.1 §8, §16).
//
// The adapter is the ONLY place destination-specific work happens. It is
// provider-neutral at the type level: the interface names no vendor and knows
// nothing about how it was invoked.
//
// AN ADAPTER MUST NOT import or reference (Sprint P2.1 §8, §16, §17, §18):
//   - React / any component / any hook
//   - a Next.js Request / Response / route context / `headers()` / cookies
//   - Prisma / `@/lib/prisma` / any repository
//   - Vercel cron / scheduling
//   - the Automation layer
//   - the Agent Framework runtime (services/agent-framework/**)
//
// AN ADAPTER DOES NOT (Sprint P2.1 §15, §16):
//   - perform authorization - the Publishing Service already checked that the
//     caller owns the Article BEFORE building the NormalizedPublishInput
//   - decide retries - it reports a typed PublishError; the service classifies
//   - read or write job / attempt rows
//   - compute or re-verify contentHash - it is handed one
//
// AN ADAPTER RECEIVES exactly a NormalizedPublishInput and returns/*throws*
// exactly PublishResult / PublishError.

import type { NormalizedPublishInput } from "./publish-input-contract";
import type { PublishResult } from "./result-contract";
import type { PublishError } from "./error-contract";
import type { PublishingDestinationId } from "./destination-contract";

/** Result of the pre-flight `validate()` call. `errors` are always
 *  VALIDATION_ERROR-coded PublishErrors describing what about THIS input the
 *  destination would reject (missing field, body too long, unsupported
 *  markup, ...). Empty `errors` + `valid: true` means `publish()` is
 *  expected to be accepted. */
export interface AdapterValidationResult {
  valid: boolean;
  errors: PublishError[];
}

export interface DestinationAdapter {
  /** The single destination this adapter serves. Must match the `destination`
   *  on every NormalizedPublishInput it is given. */
  readonly destination: PublishingDestinationId;

  /**
   * Pure-ish pre-flight check: would this input be accepted, without side
   * effects at the destination? Never throws for an expected rejection -
   * returns { valid: false, errors: [...] } instead. May still reject the
   * promise for an infrastructure failure (which the service treats as
   * TEMPORARY_FAILURE / UNKNOWN).
   */
  validate(input: NormalizedPublishInput): Promise<AdapterValidationResult>;

  /**
   * Perform the publish. Resolves with a PublishResult on success. Rejects
   * with a PublishError on failure - including DUPLICATE when the destination
   * already holds this exact content version (the service reconciles that to
   * the existing publication; it is not a retryable failure).
   *
   * MUST be safe to call again with the same input after a lost invocation:
   * a destination that already has this contentHash should return its
   * existing item (or reject DUPLICATE), never silently create a second copy.
   */
  publish(input: NormalizedPublishInput): Promise<PublishResult>;
}

/** Structural check that an object satisfies the DestinationAdapter shape.
 *  Used by contract tests and by the (future) adapter registry. */
export function isDestinationAdapter(value: unknown): value is DestinationAdapter {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.destination === "string" &&
    typeof a.validate === "function" &&
    typeof a.publish === "function"
  );
}
