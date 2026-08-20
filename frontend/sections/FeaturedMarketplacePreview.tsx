// sections/FeaturedMarketplacePreview.tsx
// Sprint M12 branding follow-on - NOT wired into app/page.tsx (the real,
// live homepage still renders FeaturedProducts, untouched). This is a
// preview-only alternative, same visual language as FeaturedProducts.tsx
// (heading treatment, card shell, grid), swapped to show a single real
// MarketplaceListing instead of the legacy /products catalogue - rendered
// only inside the owner-gated app/marketplace/preview/homepage/page.tsx, so
// a seller can see how replacing Featured Products with Marketplace
// listings would look before anyone decides to actually ship that change
// to the real homepage.
import Link from "next/link";
import Image from "next/image";
import Badge from "@/components/ui/Badge";
import { formatListingPrice, trustStateLabel, trustStateTone } from "@/lib/marketplace";
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
          {listings.map((listing) => {
            const icon = listing.media[0];
            return (
              <div
                key={listing.id}
                className="rounded-card border border-border bg-ink-2 p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:border-gold hover:shadow-raised"
              >
                <div className="flex items-center gap-2 flex-wrap mb-4">
                  {icon && <Image src={icon} alt="" width={32} height={32} className="rounded-lg border border-border" unoptimized />}
                  {listing.platformTag && (
                    <span className="text-xs font-medium rounded-control border border-gold/30 bg-gold/10 text-gold px-3 py-1">
                      {listing.platformTag}
                    </span>
                  )}
                  {listing.assetTag && (
                    <span className="rounded-control border border-border px-2 py-0.5 text-[10px] font-medium text-text-3">{listing.assetTag}</span>
                  )}
                </div>

                <h3 className="text-xl font-semibold mb-1">{listing.title}</h3>
                <p className="text-text-2 text-sm leading-6 flex-grow line-clamp-3">{listing.description}</p>

                <div className="mt-4 pt-4 border-t border-border flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-text-3">AT24 Trust State</span>
                  <Badge tone={trustStateTone(listing.trustState)}>{trustStateLabel(listing.trustState)}</Badge>
                </div>

                <div className="flex items-center justify-between mt-6">
                  <span className="text-2xl font-semibold">{formatListingPrice(listing.pricing)}</span>
                  <Link
                    href={`/marketplace/${listing.slug}`}
                    className="rounded-control bg-gold px-5 py-2 font-semibold text-ink transition hover:brightness-110"
                  >
                    View Details
                  </Link>
                </div>
              </div>
            );
          })}
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
