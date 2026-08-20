// app/marketplace/[slug]/page.tsx
// Sprint M8 - Marketplace listing detail. Server Component, same
// async-params pattern as app/products/[slug]/page.tsx (Next.js 16:
// params is a Promise). Evidence/Validation/Risk/History sections render
// real data when present and an honest "unavailable" state otherwise -
// see MarketplaceCatalogue.getBySlug for why those are always null this
// sprint (no ingestion path exists yet from the ea-research/ artifacts).
import { notFound } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import Badge from "@/components/ui/Badge";
import { MarketplaceCatalogue } from "@/services/marketplace/MarketplaceCatalogue";
import { trustStateLabel, trustStateTone } from "@/lib/marketplace";
import TrustStateSection from "@/components/marketplace/sections/TrustStateSection";
import EvidenceSection from "@/components/marketplace/sections/EvidenceSection";
import ValidationSection from "@/components/marketplace/sections/ValidationSection";
import RiskSection from "@/components/marketplace/sections/RiskSection";
import HistorySection from "@/components/marketplace/sections/HistorySection";
import VersionSection from "@/components/marketplace/sections/VersionSection";
import PurchaseCTA from "@/components/marketplace/PurchaseCTA";
import RiskDisclosure from "@/components/marketplace/RiskDisclosure";

export const revalidate = 60;

export async function generateStaticParams() {
  const slugs = await MarketplaceCatalogue.getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await MarketplaceCatalogue.getBySlug(slug);
  if (!listing) return { title: "Listing not found | AT24 Marketplace" };
  return {
    title: `${listing.title} | AT24 Marketplace`,
    description: listing.description || `Independently verified trading system on AT24 Marketplace.`,
    openGraph: { title: listing.title, description: listing.description, type: "website" },
  };
}

export default async function MarketplaceListingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await MarketplaceCatalogue.getBySlug(slug);
  if (!listing) notFound();

  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />

      {/* Hero: seller-authored identity + AT24 trust badge, visually distinct */}
      <section className="pt-32 pb-12 px-6">
        <div className="max-w-7xl mx-auto">
          <Link href="/marketplace" className="text-sm text-text-3 hover:text-gold">
            ← Back to Marketplace
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {listing.platformTag && <span className="text-xs font-semibold bg-gold/20 text-gold px-3 py-1 rounded-full">{listing.platformTag}</span>}
            {listing.assetTag && <span className="rounded-control border border-border px-2 py-0.5 text-[10px] font-medium text-text-3">{listing.assetTag}</span>}
            <Badge tone={trustStateTone(listing.trustState)}>{trustStateLabel(listing.trustState)}</Badge>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold mt-4">{listing.title}</h1>
          <p className="text-text-2 mt-3 max-w-3xl">{listing.description}</p>
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

      <Footer />
    </main>
  );
}
