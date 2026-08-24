// components/marketplace/MarketplaceGrid.tsx
// Sprint M8 - Pure renderer: grid of real MarketplaceListingSummary rows,
// or the honest empty state. Must work identically at 0/1/10/100+ items
// (M8 brief section 5/6) - no hardcoded layout assumption about count.
import EmptyState from "@/components/ui/EmptyState";
import MarketplaceListingCard from "./MarketplaceListingCard";
import type { MarketplaceListingSummary } from "@/types/marketplace";

export default function MarketplaceGrid({ items, hasActiveFilters }: { items: MarketplaceListingSummary[]; hasActiveFilters: boolean }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title={hasActiveFilters ? "No listings match your filters" : "No systems listed yet"}
        description={
          hasActiveFilters
            ? "Try broadening your search or clearing a filter."
            : "AT24's Marketplace is open for browsing, but no trading system has completed independent evidence verification and been published here yet. Check back soon."
        }
      />
    );
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {items.map((listing) => (
        <MarketplaceListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}
