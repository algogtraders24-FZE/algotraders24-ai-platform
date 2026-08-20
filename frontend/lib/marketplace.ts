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
  if (!state) return "Not yet verified";
  return state.replace(/_/g, " ");
}

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
