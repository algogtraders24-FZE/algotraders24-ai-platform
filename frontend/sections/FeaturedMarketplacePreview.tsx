// sections/FeaturedMarketplacePreview.tsx
// Sprint M12 branding follow-on - NOT wired into app/page.tsx (the real,
// live homepage still renders FeaturedProducts, untouched). This is a
// preview-only alternative, same visual language as FeaturedProducts.tsx
// (heading treatment, grid), swapped to show real MarketplaceListing rows
// instead of the legacy /products catalogue - rendered only inside the
// owner-gated app/marketplace/preview/homepage/page.tsx, so a seller can
// see how replacing Featured Products with Marketplace listings would
// look before anyone decides to actually ship that change to the real
// homepage.
//
// Card markup itself now delegates to MarketplaceListingCard (banner-first
// redesign, M12 branding follow-on #2) instead of duplicating it inline -
// one card definition, so the public /marketplace grid and this homepage
// preview can never visually drift apart.
import Link from "next/link";
import MarketplaceListingCard from "@/components/marketplace/MarketplaceListingCard";
import type { MarketplaceListingSummary } from "@/types/marketplace";

export default function FeaturedMarketplacePreview({ listings }: { listings: MarketplaceListingSummary[] }) {
  return (
    <section className="bg-ink py-16 text-text md:py-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16 mx-auto max-w-2xl">
          <span className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">
            From The Marketplace
          </span>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">
            Independently verified trading systems
          </h2>
          <p className="mt-5 text-lg text-text-2">
            Every listing below carries a real AT24 Trust Status, computed from an independent
            Evidence/Validation/Risk pipeline — not a seller-provided rating.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => (
            <MarketplaceListingCard key={listing.id} listing={listing} />
          ))}
        </div>

        <div className="text-center mt-12">
          <Link
            href="/marketplace"
            className="inline-block rounded-control border border-border px-8 py-4 font-semibold text-text transition hover:border-gold"
          >
            View Marketplace →
          </Link>
        </div>
      </div>
    </section>
  );
}
