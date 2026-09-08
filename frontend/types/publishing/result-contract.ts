// types/publishing/result-contract.ts
// AT24 Publishing Contract - Normalized publish result (Sprint P2.1 §12).
//
// A `DestinationAdapter.publish()` that succeeds RESOLVES with a PublishResult.
// One that fails REJECTS with a PublishError (error-contract.ts). There is no
// `success: false` PublishResult - failure is the error channel, not a flag.
//
// The external* fields are OPTIONAL. INTERNAL_BLOG has no external provider
// id; its adapter returns { success: true, destination, publishedAt } and
// (optionally) an on-site `externalUrl` derived from the slug. An adapter
// MUST NOT invent an id to populate `externalReference` (Sprint P2.1 §12).

import {
  type ContractViolation,
  type ContractValidationResult,
  contractResult,
  isIsoTimestamp,
} from "./common";
import { isPublishingDestinationId, type PublishingDestinationId } from "./destination-contract";

export interface PublishResult {
  /** Always true. Present so a caller can discriminate at a glance and so the
   *  shape reads symmetrically with PublishError. */
  success: true;
  destination: PublishingDestinationId;
  /** Destination-side identifier for the published item, when the destination
   *  issues one (e.g. a WordPress post id). Null/omitted for INTERNAL_BLOG. */
  externalReference?: string | null;
  /** Public URL of the published item, when known. For INTERNAL_BLOG this is
   *  the on-site canonical URL. */
  externalUrl?: string | null;
  /** When the destination confirmed publication. ISO-8601. */
  publishedAt: string;
}

export function isPublishResult(value: unknown): value is PublishResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    r.success === true &&
    isPublishingDestinationId(r.destination) &&
    isIsoTimestamp(r.publishedAt) &&
    (r.externalReference === undefined || r.externalReference === null || typeof r.externalReference === "string") &&
    (r.externalUrl === undefined || r.externalUrl === null || typeof r.externalUrl === "string")
  );
}

export function validatePublishResult(value: unknown): ContractValidationResult {
  const v: ContractViolation[] = [];
  if (!value || typeof value !== "object") {
    return contractResult([{ path: "", message: "PublishResult must be an object." }]);
  }
  const r = value as Record<string, unknown>;
  if (r.success !== true) v.push({ path: "success", message: "success must be the literal true." });
  if (!isPublishingDestinationId(r.destination)) {
    v.push({ path: "destination", message: "destination must be a known PublishingDestinationId." });
  }
  if (!isIsoTimestamp(r.publishedAt)) {
    v.push({ path: "publishedAt", message: "publishedAt must be an ISO-8601 timestamp." });
  }
  if (r.externalReference !== undefined && r.externalReference !== null && typeof r.externalReference !== "string") {
    v.push({ path: "externalReference", message: "externalReference must be a string or null." });
  }
  if (r.externalUrl !== undefined && r.externalUrl !== null && typeof r.externalUrl !== "string") {
    v.push({ path: "externalUrl", message: "externalUrl must be a string or null." });
  }
  return contractResult(v);
}
