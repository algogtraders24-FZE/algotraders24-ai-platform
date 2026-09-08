// types/publishing/destination-contract.ts
// AT24 Publishing Contract - Destination contract (Sprint P2.1).
//
// A "destination" is a place a published Article ends up. P2.1 locks the
// IDENTIFIER and the CAPABILITY DESCRIPTOR shape; it registers exactly one
// destination - INTERNAL_BLOG - and no external provider (WordPress / Ghost /
// Medium / social / webhook) (Sprint P2.1 §7, §26).
//
// EXTENSIBILITY RULE: adding a destination later is one new member of
// PublishingDestinationId + one entry in PUBLISHING_DESTINATIONS. It must NOT
// require any change to PublishingJob / PublishingAttempt / PublishResult /
// PublishError semantics. If a future destination cannot be expressed without
// changing those, that is a contract-version bump, decided deliberately - not
// a silent widening.

import { isNonEmptyString } from "./common";

/** The closed set of destination identifiers. UPPERCASE string union, matching
 *  the sibling marketplace publishing vocabulary
 *  (types/marketplace.ts#PublicationState, types/marketplace-factory.ts#SubmissionState). */
export type PublishingDestinationId = "INTERNAL_BLOG";

export const PUBLISHING_DESTINATION_IDS: readonly PublishingDestinationId[] = ["INTERNAL_BLOG"] as const;

export function isPublishingDestinationId(value: unknown): value is PublishingDestinationId {
  return typeof value === "string" && (PUBLISHING_DESTINATION_IDS as readonly string[]).includes(value);
}

/** Declarative capabilities of a destination. The Publishing Service reads
 *  this to decide what operations are even attemptable; an adapter never has
 *  to be asked "can you do X" at runtime for a static fact. */
export interface PublishingDestinationDescriptor {
  id: PublishingDestinationId;
  /** Human-readable, for dashboards / logs. Never a provider brand name in
   *  user-facing copy beyond what the product has approved. */
  label: string;
  /**
   * True when a real publish needs credentials for an external system
   * (API token, OAuth, app password). INTERNAL_BLOG = false: it writes to
   * AT24's own datastore, so there is NO publishing-provider secret for it
   * and none must ever be invented (Sprint P2.1 §12).
   */
  requiresExternalCredentials: boolean;
  /** Can an already-published item be updated in place at this destination? */
  supportsUpdate: boolean;
  /** Can an already-published item be unpublished / retracted at this destination? */
  supportsUnpublish: boolean;
  /**
   * Does a successful publish yield a destination-side identifier
   * (externalReference) and/or URL? INTERNAL_BLOG has no external provider
   * id; its canonical URL is derived from the Article slug. Adapters for
   * INTERNAL_BLOG MUST NOT fabricate an id to fill the field (Sprint P2.1 §12).
   */
  providesExternalReference: boolean;
}

export const PUBLISHING_DESTINATIONS: Readonly<
  Record<PublishingDestinationId, PublishingDestinationDescriptor>
> = Object.freeze({
  INTERNAL_BLOG: {
    id: "INTERNAL_BLOG",
    label: "AT24 Blog",
    requiresExternalCredentials: false,
    supportsUpdate: true,
    supportsUnpublish: true,
    providesExternalReference: false,
  },
});

export function getPublishingDestination(
  id: PublishingDestinationId,
): PublishingDestinationDescriptor {
  return PUBLISHING_DESTINATIONS[id];
}

/** Pure shape check for an externally-supplied descriptor (e.g. from a test
 *  double or a future config source). */
export function isPublishingDestinationDescriptor(
  value: unknown,
): value is PublishingDestinationDescriptor {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    isPublishingDestinationId(d.id) &&
    isNonEmptyString(d.label) &&
    typeof d.requiresExternalCredentials === "boolean" &&
    typeof d.supportsUpdate === "boolean" &&
    typeof d.supportsUnpublish === "boolean" &&
    typeof d.providesExternalReference === "boolean"
  );
}
