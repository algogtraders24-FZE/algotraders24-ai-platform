// sections/FeaturedMarketplace.tsx
// Sprint M12 branding follow-on - REAL, public homepage section. Replaces
// FeaturedProducts.tsx on app/page.tsx per explicit direction: the
// homepage now features real Marketplace listings (independently verified
// via the M2-M7 pipeline) instead of the legacy /products catalogue.
// FeaturedProducts.tsx itself is left in the codebase, unused - not
// deleted, in case that catalogue is ever wanted back.
//
// Uses the exact same public MarketplaceCatalogue.search() query as
// /marketplace and /api/marketplace/search - only PUBLICLY_VISIBLE_STATES
// (READY/PUBLISHED) listings can ever appear here, same gate as everywhere
// else. Card rendering itself lives in FeaturedMarketplacePreview.tsx
// (shared with the owner-only homepage preview route) so the public
// homepage and the preview always render identically.
import { MarketplaceCatalogue } from "@/services/marketplace/MarketplaceCatalogue";
import FeaturedMarketplacePreview from "@/sections/FeaturedMarketplacePreview";

export const revalidate = 60;

export default async function FeaturedMarketplace() {
  const result = await MarketplaceCatalogue.search({ page: 1, pageSize: 3, sort: "newest" });

  if (result.items.length === 0) {
    return (
      <section className="bg-ink py-16 text-text md:py-24">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <span className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">From The Marketplace</span>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">Marketplace launching soon</h2>
          <p className="mt-5 text-lg text-text-2">Independently verified trading systems will appear here as they clear review.</p>
        </div>
      </section>
    );
  }

  return <FeaturedMarketplacePreview listings={result.items} />;
}
