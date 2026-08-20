// components/marketplace/MarketplaceListingCard.tsx
// Sprint M8 - Same visual family as components/product/ProductCard.tsx
// (rounded-2xl bg-ink-3 border hover:border-gold), extended with the
// Marketplace-specific facts: Trust State (always the literal M7 value,
// never a score/star/percentage - section 8), and a clear seller/AT24
// visual boundary (section 7: "AT24-generated facts must be visually
// distinct from seller-authored content").
import Link from "next/link";
import Image from "next/image";
import Badge from "@/components/ui/Badge";
import { formatListingPrice, trustStateLabel, trustStateTone } from "@/lib/marketplace";
import type { MarketplaceListingSummary } from "@/types/marketplace";

export default function MarketplaceListingCard({ listing }: { listing: MarketplaceListingSummary }) {
  const icon = listing.media[0];
  return (
    <div className="rounded-2xl bg-ink-3 border border-border p-6 flex flex-col hover:border-gold transition duration-300">
      {/* Top: icon (media[0], if uploaded) + platform/asset tags */}
      <div className="flex items-center gap-2 flex-wrap">
        {icon && <Image src={icon} alt="" width={32} height={32} className="rounded-lg border border-border" unoptimized />}
        {listing.platformTag && (
          <span className="text-xs font-semibold bg-gold/20 text-gold px-3 py-1 rounded-full">{listing.platformTag}</span>
        )}
        {listing.assetTag && (
          <span className="rounded-control border border-border px-2 py-0.5 text-[10px] font-medium text-text-3">{listing.assetTag}</span>
        )}
      </div>

      {/* Seller-authored block */}
      <h3 className="text-xl font-bold mt-4 mb-1">{listing.title}</h3>
      <p className="text-text-2 text-sm line-clamp-2">{listing.description}</p>
      <p className="mt-2 text-xs text-text-3">
        by {listing.sellerName ?? "Unknown seller"} <span className="text-text-3/60">· seller-provided</span>
      </p>

      <div className="flex-grow" />

      {/* AT24-computed block - visually separated by a divider, never
          blended into the seller copy above. */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-text-3">AT24 Trust State</span>
          <Badge tone={trustStateTone(listing.trustState)}>{trustStateLabel(listing.trustState)}</Badge>
        </div>
        {listing.lastEvidenceAt && (
          <p className="mt-1 text-[11px] text-text-3">Last evidence: {new Date(listing.lastEvidenceAt).toLocaleDateString()}</p>
        )}
      </div>

      {/* Bottom: price + CTA */}
      <div className="flex items-center justify-between mt-6">
        <span className="text-lg font-bold">{formatListingPrice(listing.pricing)}</span>
        <Link href={`/marketplace/${listing.slug}`} className="bg-gold hover:brightness-110 px-5 py-2 rounded-xl font-semibold transition text-sm">
          View
        </Link>
      </div>
    </div>
  );
}
