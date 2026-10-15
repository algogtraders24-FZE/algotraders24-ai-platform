// app/marketplace/[slug]/page.tsx
// Sprint M8 - Marketplace listing detail. Server Component, same
// async-params pattern as app/products/[slug]/page.tsx (Next.js 16:
// params is a Promise). Evidence/Validation/Risk/History sections render
// real data when present and an honest "unavailable" state otherwise -
// see MarketplaceCatalogue.getBySlug for why those are always null this
// sprint (no ingestion path exists yet from the ea-research/ artifacts).
import { notFound } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import { MarketplaceCatalogue } from "@/services/marketplace/MarketplaceCatalogue";
import ListingDetailView from "@/components/marketplace/ListingDetailView";
import ListingResultsCard from "@/components/live-results/ListingResultsCard";
import { listingResults } from "@/services/live-results/follow-store";
import ReportListingPanel from "@/components/marketplace/ReportListingPanel";
import ReportCheckCard from "@/components/marketplace/ReportCheckCard";
import { latestReportCheck } from "@/services/marketplace/reportCheckStore";
import { breadcrumbJsonLd, jsonLdString, metaDescription, productJsonLd } from "@/lib/seo/seo";

export const revalidate = 60;

export async function generateStaticParams() {
  const slugs = await MarketplaceCatalogue.getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await MarketplaceCatalogue.getBySlug(slug);
  if (!listing) return { title: "Listing not found | AT24 Marketplace", robots: { index: false, follow: false } };
  const description = metaDescription(listing.description, `${listing.title} - ${[listing.platformTag, listing.assetTag].filter(Boolean).join(" ")} trading system on the AT24 Marketplace, with AT24-computed evidence disclosed.`);
  return {
    title: `${listing.title} | AT24 Marketplace`,
    description,
    // Self-referential canonical: without it every listing inherited the homepage as canonical and was never indexable.
    alternates: { canonical: `/marketplace/${listing.slug}` },
    keywords: [...new Set([listing.platformTag, listing.assetTag, ...listing.tags].filter(Boolean))],
    openGraph: { title: listing.title, description, type: "website", url: `/marketplace/${listing.slug}` },
    twitter: { card: "summary_large_image", title: listing.title, description },
  };
}

export default async function MarketplaceListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { slug } = await params;
  const { checkout } = await searchParams;
  const listing = await MarketplaceCatalogue.getBySlug(slug);
  if (!listing) notFound();
  // Public Live Results pages the seller attached to this listing (empty when none or when the feature is off).
  const liveResults = await listingResults(slug);
  // The seller's own backtest report, if one was attached and AT24 finished reading it (otherwise nothing is shown).
  const reportCheck = await latestReportCheck(listing.id);

  return (
    <main className="min-h-screen bg-ink text-text">
      {/* Structured data: Product (+ Offer only when there is a price and a real release) and the breadcrumb. No rating or review is ever claimed. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(productJsonLd(listing)) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Marketplace", path: "/marketplace" }, { name: listing.title, path: `/marketplace/${listing.slug}` }])) }}
      />
      <Navbar />
      <ListingDetailView listing={listing} justPurchased={checkout === "success"} liveResults={liveResults.length > 0 ? { stale: liveResults[0].stale } : undefined} />
      <ReportCheckCard check={reportCheck} live={liveResults[0] ? { mode: liveResults[0].mode, maxDrawdownPct: liveResults[0].maxDrawdownPct, trades: liveResults[0].liveTracked.trades, daysTracked: liveResults[0].daysSinceFirstSync } : null} />
      <ListingResultsCard items={liveResults} />
      <ReportListingPanel listingId={listing.id} />
      <Footer />
    </main>
  );
}
