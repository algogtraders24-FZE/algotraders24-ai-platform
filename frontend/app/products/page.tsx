// app/products/page.tsx
// Sprint 14E - Server Component. The catalogue now comes from PostgreSQL via
// ProductCatalogue; filtering stays client-side in ProductsClient.
// Markup, layout and styling are unchanged.
//
// Sprint D2.4.A1 - ProductsClient now reads useSearchParams() (for the new
// Footer's ?category= links), which requires a Suspense boundary around it
// in the App Router - without one, reading search params during static
// rendering is an error, not just a warning.
//
// Sprint D2.4.A2 - now also renders the full <Platforms /> grid (unabridged
// descriptions). The homepage's copy shrank to a compact chip strip linking
// here, so this is where the full "which ecosystem" detail now lives.
import { Suspense } from "react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import Platforms from "@/sections/Platforms";
import ProductsClient from "./ProductsClient";
import { ProductCatalogue } from "@/services/products/ProductCatalogue";

export const revalidate = 300; // re-generate at most every 5 minutes

export default async function ProductsPage() {
  const products = await ProductCatalogue.getAll();

  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />

      <section className="pt-32 pb-12 px-6">
        <div className="max-w-7xl mx-auto text-center">
          <span className="text-gold font-semibold tracking-wide uppercase text-sm">
            Marketplace
          </span>
          <h1 className="text-4xl md:text-6xl font-bold mt-4">
            AI Trading Products
          </h1>
          <p className="text-text-2 mt-4 max-w-2xl mx-auto text-lg">
            Premium Expert Advisors, indicators and bots for every major
            trading platform.
          </p>
        </div>
      </section>

      <Suspense fallback={null}>
        <ProductsClient products={products} />
      </Suspense>

      <Platforms />

      <Footer />
    </main>
  );
}