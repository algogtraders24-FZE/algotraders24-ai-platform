// components/marketplace/PurchaseCTA.tsx
// Sprint M8 - Section 28: no payment integration is implemented in M8, and
// none is faked. Renders an honest "not yet available" state rather than
// a button that pretends to purchase something.
import { formatListingPrice } from "@/lib/marketplace";
import type { ListingPricing } from "@/types/marketplace";

export default function PurchaseCTA({ pricing }: { pricing: ListingPricing }) {
  return (
    <div className="rounded-2xl bg-ink-3 border border-border p-6 flex flex-col gap-3">
      <span className="text-2xl font-bold">{formatListingPrice(pricing)}</span>
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="w-full rounded-xl bg-ink-2 border border-border text-text-3 px-5 py-3 font-semibold cursor-not-allowed"
        title="Purchasing is not yet available on AT24 Marketplace"
      >
        Purchasing coming soon
      </button>
      <p className="text-xs text-text-3">AT24 Marketplace does not yet process purchases. No payment will be requested or charged.</p>
    </div>
  );
}
