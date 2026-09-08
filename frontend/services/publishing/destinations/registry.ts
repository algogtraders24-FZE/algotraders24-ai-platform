// services/publishing/destinations/registry.ts
// AT24 Publishing Engine (P2.2) - resolves a PublishingDestinationId to its
// DestinationAdapter. One entry today (INTERNAL_BLOG). Adding a destination
// later is one import + one entry here; no other module changes.

import type { DestinationAdapter, PublishingDestinationId } from "@/types/publishing";
import { PUBLISHING_DESTINATION_IDS } from "@/types/publishing";
import { internalBlogAdapter } from "./internal-blog.adapter";

const ADAPTERS: Readonly<Record<PublishingDestinationId, DestinationAdapter>> = Object.freeze({
  INTERNAL_BLOG: internalBlogAdapter,
});

export function getDestinationAdapter(destination: PublishingDestinationId): DestinationAdapter {
  const adapter = ADAPTERS[destination];
  if (!adapter) {
    // Unreachable while PublishingDestinationId and ADAPTERS stay in sync -
    // this guards a future id added to the union but not the registry.
    throw new Error(`No DestinationAdapter registered for "${destination}"`);
  }
  return adapter;
}

/** True iff every declared destination id has a registered adapter. Used by
 *  the contract test to pin registry/union parity. */
export function everyDestinationHasAdapter(): boolean {
  return PUBLISHING_DESTINATION_IDS.every((id) => id in ADAPTERS);
}
