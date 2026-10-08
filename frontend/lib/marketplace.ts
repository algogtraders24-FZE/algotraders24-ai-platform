// lib/marketplace.ts
// Sprint M8 - Small display helpers shared by MarketplaceListingCard and
// the detail page sections. Deliberately does NOT convert TrustState into
// a score/percentage/stars anywhere (M8 brief section 8) - only maps each
// literal state to a Badge *tone* (color), the state's own text is always
// shown verbatim.
import type { BadgeTone } from "@/components/ui/Badge";
import type { ListingPricing, PublicationState, TrustState } from "@/types/marketplace";

const TRUST_STATE_TONE: Record<TrustState, BadgeTone> = {
  UNVERIFIED: "neutral",
  VALIDATION_PENDING: "info",
  INCONCLUSIVE: "warning",
  LIMITED: "warning",
  UNDER_OBSERVATION: "info",
  VALIDATED: "success",
  INVALIDATED: "danger",
  SUPERSEDED: "neutral",
};

export function trustStateTone(state: TrustState | null | undefined): BadgeTone {
  if (!state) return "neutral";
  return TRUST_STATE_TONE[state] ?? "neutral";
}

// Human-readable label only - never a translation of meaning (e.g. never
// "Validated = Good"). "UNDER OBSERVATION" per the brief's own display
// example (section 8); every other state keeps its literal underscore form
// converted to spaces, nothing more.
export function trustStateLabel(state: TrustState | null | undefined): string {
  if (!state) return "Not checked";
  return state.replace(/_/g, " ");
}

// Utilities (e.g. the Local Trade Copier) have no trading performance, so the M2-M7 evidence chain - and
// therefore a Trust State - does not apply to them. A utility whose seller tagged it "demo-tested" (its
// description states exactly what was and was not tested) gets this separate green label instead. It is
// NOT a Trust State and is never shown for a listing that has one.
export function isDemoTestedUtility(listing: { trustState?: string | null; category?: string | null; tags?: string[] | null }): boolean {
  return !listing.trustState && listing.category === "Utility" && (listing.tags ?? []).includes("demo-tested");
}

export const DEMO_TESTED_HINT = "Tested on demo accounts by the seller. A utility has no trading performance, so no Trust State applies - see the description for exactly what was tested.";

const PUBLICATION_STATE_TONE: Record<PublicationState, BadgeTone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  UNDER_REVIEW: "info",
  EVIDENCE_PENDING: "info",
  VALIDATION_PENDING: "info",
  READY: "gold",
  PUBLISHED: "success",
  SUSPENDED: "warning",
  RETIRED: "neutral",
};

export function publicationStateTone(state: PublicationState): BadgeTone {
  return PUBLICATION_STATE_TONE[state] ?? "neutral";
}

export function formatListingPrice(pricing: ListingPricing): string {
  if (pricing.model === "free") return "Free";
  if (pricing.model === "unavailable" || pricing.amount == null) return "Price unavailable";
  const amount = `${pricing.currency ?? "USD"} ${pricing.amount.toLocaleString()}`;
  if (pricing.model === "subscription") return `${amount} / ${pricing.interval ?? "month"}`;
  return amount;
}
