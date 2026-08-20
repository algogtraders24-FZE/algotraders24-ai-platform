// components/marketplace/ListingDetailView.tsx
// Sprint M12 branding follow-on - the actual detail-page rendering,
// extracted out of app/marketplace/[slug]/page.tsx unchanged so the new
// owner-only preview page (app/marketplace/preview/[id]/page.tsx) renders
// the exact same real component a buyer would see, not a recreated
// approximation. Adds hero media rendering (media[0]=icon, media[1]=banner)
// on top of the original JSX, which previously rendered no image at all.
import Link from "next/link";
import Image from "next/image";
import Badge from "@/components/ui/Badge";
import { trustStateLabel, trustStateTone } from "@/lib/marketplace";
import TrustStateSection from "@/components/marketplace/sections/TrustStateSection";
import EvidenceSection from "@/components/marketplace/sections/EvidenceSection";
import ValidationSection from "@/components/marketplace/sections/ValidationSection";
import RiskSection from "@/components/marketplace/sections/RiskSection";
import HistorySection from "@/components/marketplace/sections/HistorySection";
import VersionSection from "@/components/marketplace/sections/VersionSection";
import PurchaseCTA from "@/components/marketplace/PurchaseCTA";
import RiskDisclosure from "@/components/marketplace/RiskDisclosure";
import type { MarketplaceListingDetail } from "@/types/marketplace";

export default function ListingDetailView({
  listing,
  backHref = "/marketplace",
  backLabel = "← Back to Marketplace",
}: {
  listing: MarketplaceListingDetail;
  backHref?: string;
  backLabel?: string;
}) {
  const icon = listing.media[0];
  const banner = listing.media[1];

  return (
    <>
      {/* Hero: seller-authored identity + AT24 trust badge, visually distinct */}
      <section className="pt-32 pb-12 px-6">
        <div className="max-w-7xl mx-auto">
          <Link href={backHref} className="text-sm text-text-3 hover:text-gold">
            {backLabel}
          </Link>

          {banner && (
            <div className="mt-6 overflow-hidden rounded-2xl border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG banners upload here; next/image's optimizer doesn't apply to SVG anyway */}
              <img src={banner} alt="" className="w-full h-auto block" />
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {icon && (
              <Image src={icon} alt="" width={56} height={56} className="rounded-xl border border-border" unoptimized />
            )}
            {listing.platformTag && <span className="text-xs font-semibold bg-gold/20 text-gold px-3 py-1 rounded-full">{listing.platformTag}</span>}
            {listing.assetTag && <span className="rounded-control border border-border px-2 py-0.5 text-[10px] font-medium text-text-3">{listing.assetTag}</span>}
            <Badge tone={trustStateTone(listing.trustState)}>{trustStateLabel(listing.trustState)}</Badge>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold mt-4">{listing.title}</h1>
          <p className="text-text-2 mt-3 max-w-3xl whitespace-pre-line">{listing.description}</p>
          <p className="text-xs text-text-3 mt-2">
            Listed by {listing.sellerName ?? "Unknown seller"} <span className="text-text-3/60">· seller-provided identity</span>
          </p>
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <TrustStateSection trustInfo={listing.trustInfo} />
            <EvidenceSection evidence={listing.evidence} />
            <ValidationSection validation={listing.validation} />
            <RiskSection risk={listing.risk} />
            <HistorySection history={listing.history} />
            <VersionSection versionId={listing.versionId} tradingSystemId={listing.tradingSystemId} />
          </div>
          <div className="space-y-6">
            <PurchaseCTA pricing={listing.pricing} />
            <RiskDisclosure />
          </div>
        </div>
      </section>
    </>
  );
}
