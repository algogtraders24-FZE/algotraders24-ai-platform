"use client";

import { useState } from "react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import CategoryFilter from "@/components/product/CategoryFilter";
import ProductGrid from "@/components/product/ProductGrid";
import { PRODUCTS } from "@/data/products";
import type { ProductCategoryId } from "@/types/product";

export default function ProductsPage() {
  const [active, setActive] = useState<ProductCategoryId | "all">("all");

  const filteredProducts =
    active === "all"
      ? PRODUCTS
      : PRODUCTS.filter((product) => product.category === active);

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

      <section className="px-6 mb-12">
        <div className="max-w-7xl mx-auto">
          <CategoryFilter active={active} onChange={setActive} />
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="max-w-7xl mx-auto">
          <ProductGrid products={filteredProducts} />
        </div>
      </section>

      <Footer />
    </main>
  );
}