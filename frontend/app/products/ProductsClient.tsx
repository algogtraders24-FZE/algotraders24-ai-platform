"use client";
// app/products/ProductsClient.tsx
// Sprint 14E - Client half of the products page: category filter state and
// rendering. Product data is fetched on the server and passed in as props.
import { useState } from "react";
import CategoryFilter from "@/components/product/CategoryFilter";
import ProductGrid from "@/components/product/ProductGrid";
import type { Product, ProductCategoryId } from "@/types/product";

export default function ProductsClient({ products }: { products: Product[] }) {
  const [active, setActive] = useState<ProductCategoryId | "all">("all");

  const filteredProducts =
    active === "all"
      ? products
      : products.filter((product) => product.category === active);

  return (
    <>
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
    </>
  );
}