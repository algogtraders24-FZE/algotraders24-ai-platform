// app/marketplace/page.tsx
// Sprint M8 - AT24 Marketplace catalog. Server Component: fetches the
// real first page directly via Prisma (same SSR-for-SEO approach as
// app/products/page.tsx), zero real listings exist yet (product creation
// is forbidden this sprint - see M8_database_architecture_audit.md), so
// this genuinely, honestly renders the empty state on a fresh deploy, not
// a hardcoded "0 products" special case.
import Link from "next/link";
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
  alternates: { canonical: "/marketplace" },
  openGraph: {
    title: "AT24 Marketplace",
    description: "Independently verified trading systems, with AT24-computed evidence and Trust State disclosed for every listing.",
    type: "website",
    url: "/marketplace",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "AT24 Marketplace - independently verified trading systems" }],
  },
  twitter: { card: "summary_large_image", title: "AT24 Marketplace", images: ["/og-image.png"] },
};

export default async function MarketplacePage() {
  const initialResult = await MarketplaceCatalogue.search({ page: 1, pageSize: 24, sort: "newest" });
  // The grid above only server-renders the first 24 listings; the rest load by client-side paging, which a crawler cannot follow.
  // This plain link list reaches every public listing (Search Console showed listings beyond the first 24 as never crawled).
  const everyListing = await MarketplaceCatalogue.search({ page: 1, pageSize: 100, sort: "newest" }).catch(() => null);

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
          {everyListing && everyListing.items.length > 0 && (
            <nav aria-label="All systems" className="mt-16 border-t border-border pt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-text-3">All systems ({everyListing.items.length})</h2>
              <ul className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {everyListing.items.map((l) => (
                  <li key={l.slug}>
                    <Link href={`/marketplace/${l.slug}`} className="text-text-2 hover:text-gold">
                      {l.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
