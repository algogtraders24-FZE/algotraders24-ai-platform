// types/publishing/idempotency-contract.ts
// AT24 Publishing Contract - Publication identity & idempotency (Sprint P2.1 §11).
//
// The LOGICAL identity of "this content, published here" is the triple:
//
//     articleId  +  destination  +  contentHash
//
//  - articleId    : which Article (SOURCE identity - stable across edits)
//  - destination  : where it is going
//  - contentHash  : which content VERSION (publish-input-contract.ts)
//
// P2.1 defines this identity and the string key a future persistence layer
// will enforce uniqueness on. P2.1 does NOT add a DB migration - that is P2.2
// (Sprint P2.1 §11, §19). The unique constraint, when it lands, is on
// (articleId, destination, contentHash).
//
// Idempotency rule (for P2.3 execution, stated here so the contract is
// complete):
//   * A PublishingJob for an identity that already has a SUCCEEDED job is a
//     no-op that returns the existing publication.
//   * A DUPLICATE PublishError from an adapter (error-contract.ts) is
//     reconciled to the existing publication, never counted as a failure to
//     retry.
//   * Re-publishing after a content edit is a DIFFERENT identity (new
//     contentHash) and a legitimately new job.

import {
  type ContractViolation,
  type ContractValidationResult,
  contractResult,
  isNonEmptyString,
  isSha256Hex,
} from "./common";
import { isPublishingDestinationId, type PublishingDestinationId } from "./destination-contract";

export interface PublicationIdentity {
  articleId: string;
  destination: PublishingDestinationId;
  contentHash: string;
}

/** Field separator for the flat key. `:` cannot appear in a cuid, a
 *  destination id, or a hex hash, so the key is unambiguous and reversible. */
const KEY_SEP = ":";

/**
 * The deterministic string form of a PublicationIdentity. This is the value a
 * `@@unique` index / upsert key is built on in P2.2, and the natural
 * `idempotencyKey` for a PublishingJob (job-contract.ts).
 *
 *   publicationIdentityKey({ articleId: "abc", destination: "INTERNAL_BLOG", contentHash: "9f..." })
 *     === "abc:INTERNAL_BLOG:9f..."
 */
export function publicationIdentityKey(identity: PublicationIdentity): string {
  return [identity.articleId, identity.destination, identity.contentHash].join(KEY_SEP);
}

/** Reverse of publicationIdentityKey. Returns null if the string is not a
 *  well-formed key. */
export function parsePublicationIdentityKey(key: string): PublicationIdentity | null {
  const parts = key.split(KEY_SEP);
  if (parts.length !== 3) return null;
  const [articleId, destination, contentHash] = parts;
  if (!isNonEmptyString(articleId) || !isPublishingDestinationId(destination) || !isSha256Hex(contentHash)) {
    return null;
  }
  return { articleId, destination, contentHash };
}

export function publicationIdentityEquals(a: PublicationIdentity, b: PublicationIdentity): boolean {
  return a.articleId === b.articleId && a.destination === b.destination && a.contentHash === b.contentHash;
}

export function isPublicationIdentity(value: unknown): value is PublicationIdentity {
  if (!value || typeof value !== "object") return false;
  const i = value as Record<string, unknown>;
  return (
    isNonEmptyString(i.articleId) &&
    isPublishingDestinationId(i.destination) &&
    isSha256Hex(i.contentHash)
  );
}

export function validatePublicationIdentity(value: unknown): ContractValidationResult {
  const v: ContractViolation[] = [];
  if (!value || typeof value !== "object") {
    return contractResult([{ path: "", message: "PublicationIdentity must be an object." }]);
  }
  const i = value as Record<string, unknown>;
  if (!isNonEmptyString(i.articleId)) v.push({ path: "articleId", message: "articleId is required." });
  if (!isPublishingDestinationId(i.destination)) {
    v.push({ path: "destination", message: "destination must be a known PublishingDestinationId." });
  }
  if (!isSha256Hex(i.contentHash)) {
    v.push({ path: "contentHash", message: "contentHash must be a 64-char lowercase sha256 hex string." });
  }
  return contractResult(v);
}
