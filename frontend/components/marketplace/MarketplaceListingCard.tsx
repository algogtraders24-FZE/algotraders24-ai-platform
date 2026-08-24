// components/marketplace/MarketplaceListingCard.tsx
// Sprint M8, redesigned M12 branding follow-on ("look at MQL5's product
// section UI" - session direction) - same visual family as
// components/product/ProductCard.tsx, but now banner-image-first like a
// real marketplace grid needs to be at scale (MQL5's own card: a big
// square product image is the dominant element, name/price/rating are
// small text below it). Kept ONE honest difference on purpose: MQL5 bakes
// marketing claims ("40% OFF", "only N left") directly into the image
// pixels; AT24 never does that - the only thing overlaid on the image is
// the real AT24 Trust State (section 8: always the literal M7 value,
// never a score/star/percentage), which is computed data, not marketing
// copy, and stays visually distinct from the seller-authored image below
// it via a semi-opaque chip rather than being drawn into the artwork.
import Link from "next/link";
import Image from "next/image";
import Badge from "@/components/ui/Badge";
import { formatListingPrice, trustStateLabel, trustStateTone } from "@/lib/marketplace";
import type { MarketplaceListingSummary } from "@/types/marketplace";

export default function MarketplaceListingCard({ listing }: { listing: MarketplaceListingSummary }) {
  const icon = listing.media[0];
  const banner = listing.media[1] ?? listing.media[0];

  return (
    <Link
      href={`/marketplace/${listing.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-ink-3 transition duration-300 hover:border-gold hover:shadow-raised"
    >
      {/* Product poster - the dominant visual, like MQL5's grid. Real
          uploaded banner only; no placeholder marketing graphic. */}
      <div className="relative aspect-square w-full overflow-hidden bg-ink-2">
        {banner ? (
          <Image
            src={banner}
            alt=""
            fill
            unoptimized
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-5xl font-bold text-text-3/25">
            {listing.title.slice(0, 1)}
          </div>
        )}
        {listing.platformTag && (
          <span className="absolute left-3 top-3 rounded-full bg-ink/80 px-3 py-1 text-xs font-semibold text-gold backdrop-blur">
            {listing.platformTag}
          </span>
        )}
        {/* AT24-computed fact, overlaid but never blended into the seller's
            own image content - a real chip, not a drawn-in badge. */}
        <span className="absolute right-3 top-3">
          <Badge tone={trustStateTone(listing.trustState)}>{trustStateLabel(listing.trustState)}</Badge>
        </span>
      </div>

      {/* Seller-authored, kept minimal - full description lives on the
          detail page only, not in the scan-grid. */}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2">
          {icon && (
            <Image src={icon} alt="" width={20} height={20} className="shrink-0 rounded border border-border" unoptimized />
          )}
          <h3 className="truncate text-base font-bold">{listing.title}</h3>
        </div>
        <p className="mt-1 truncate text-xs text-text-3">by {listing.sellerName ?? "Unknown seller"}</p>

        <div className="flex-grow" />

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-lg font-bold">{formatListingPrice(listing.pricing)}</span>
          {listing.assetTag && (
            <span className="rounded-control border border-border px-2 py-0.5 text-[10px] font-medium text-text-3">{listing.assetTag}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
