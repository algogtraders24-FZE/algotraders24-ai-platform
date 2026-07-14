// app/products/page.tsx
// Sprint 14E - Server Component. The catalogue now comes from PostgreSQL via
// ProductCatalogue; filtering stays client-side in ProductsClient.
// Markup, layout and styling are unchanged.
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import ProductsClient from "./ProductsClient";
import { ProductCatalogue } from "@/services/products/ProductCatalogue";

export const revalidate = 300; // re-generate at most every 5 minutes

export default async function ProductsPage() {
  const products = await ProductCatalogue.getAll();

  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <Navbar />

      <section className="pt-32 pb-12 px-6">
        <div className="max-w-7xl mx-auto text-center">
          <span className="text-blue-500 font-semibold tracking-wide uppercase text-sm">
            Marketplace
          </span>
          <h1 className="text-4xl md:text-6xl font-bold mt-4">
            AI Trading Products
          </h1>
          <p className="text-gray-400 mt-4 max-w-2xl mx-auto text-lg">
            Premium Expert Advisors, indicators and bots for every major
            trading platform.
          </p>
        </div>
      </section>

      <ProductsClient products={products} />

      <Footer />
    </main>
  );
}