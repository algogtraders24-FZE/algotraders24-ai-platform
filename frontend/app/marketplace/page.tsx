// app/marketplace/page.tsx
// Sprint M8 - AT24 Marketplace catalog. Server Component: fetches the
// real first page directly via Prisma (same SSR-for-SEO approach as
// app/products/page.tsx), zero real listings exist yet (product creation
// is forbidden this sprint - see M8_database_architecture_audit.md), so
// this genuinely, honestly renders the empty state on a fresh deploy, not
// a hardcoded "0 products" special case.
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import MarketplaceClient from "./MarketplaceClient";
import { MarketplaceCatalogue } from "@/services/marketplace/MarketplaceCatalogue";

export const revalidate = 60; // shorter than /products' 300s - evidence-backed state should feel fresher

export const metadata = {
  title: "Marketplace | AT24 — Independently Verified Trading Systems",
  description:
    "Browse trading systems with independently verified evidence, validation, and risk analysis. AT24 computes and discloses evidence-based Trust State for every listing - never a seller-authored claim.",
  openGraph: {
    title: "AT24 Marketplace",
    description: "Independently verified trading systems, with AT24-computed evidence and Trust State disclosed for every listing.",
    type: "website",
  },
};

export default async function MarketplacePage() {
  const initialResult = await MarketplaceCatalogue.search({ page: 1, pageSize: 24, sort: "newest" });

  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />

      <PageHero
        eyebrow="Marketplace"
        title="Independently Verified Trading Systems"
        subtitle="Every listing carries AT24-computed evidence, validation, and Trust State - never a seller's own performance claim presented as verified."
      />

      <section className="px-6 pb-24">
        <div className="max-w-7xl mx-auto">
          <MarketplaceClient initialResult={initialResult} />
        </div>
      </section>

      <Footer />
    </main>
  );
}
