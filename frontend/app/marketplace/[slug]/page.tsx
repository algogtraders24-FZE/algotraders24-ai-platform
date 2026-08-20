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
      <ListingDetailView listing={listing} />
      <Footer />
    </main>
  );
}
