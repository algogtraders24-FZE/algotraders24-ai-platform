// app/marketplace/page.tsx
// Sprint M8 - AT24 Marketplace catalog. Server Component: fetches the
// real first page directly via Prisma (same SSR-for-SEO approach as
// app/products/page.tsx), zero real listings exist yet (product creation
// is forbidden this sprint - see M8_database_architecture_audit.md), so
// this genuinely, honestly renders the empty state on a fresh deploy, not
// a hardcoded "0 products" special case.
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
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

      <section className="pt-32 pb-12 px-6">
        <div className="max-w-7xl mx-auto text-center">
          <span className="text-gold font-semibold tracking-wide uppercase text-sm">Marketplace</span>
          <h1 className="text-4xl md:text-6xl font-bold mt-4">Independently Verified Trading Systems</h1>
          <p className="text-text-2 mt-4 max-w-2xl mx-auto text-lg">
            Every listing carries AT24-computed evidence, validation, and Trust State — never a seller&apos;s own performance claim
            presented as verified.
          </p>
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="max-w-7xl mx-auto">
          <MarketplaceClient initialResult={initialResult} />
        </div>
      </section>

      <Footer />
    </main>
  );
}
