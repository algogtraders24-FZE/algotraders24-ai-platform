"use client";
// app/products/ProductsClient.tsx
// Sprint 14E - Client half of the products page: category filter state and
// rendering. Product data is fetched on the server and passed in as props.
//
// Sprint D2.4.A1 - reads an initial `?category=` query param (the new
// Footer's category-specific links, e.g. /products?category=mt5-expert-advisors)
// so those links land pre-filtered instead of on the unfiltered "All"
// view. An unrecognized/absent value falls back to "all" - never a blank
// or error state.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CATEGORIES } from "@/data/categories";
import CategoryFilter from "@/components/product/CategoryFilter";
import ProductGrid from "@/components/product/ProductGrid";
import type { Product, ProductCategoryId } from "@/types/product";

function initialCategory(param: string | null): ProductCategoryId | "all" {
  if (param && CATEGORIES.some((c) => c.id === param)) return param as ProductCategoryId;
  return "all";
}

export default function ProductsClient({ products }: { products: Product[] }) {
  const searchParams = useSearchParams();
  const [active, setActive] = useState<ProductCategoryId | "all">(() => initialCategory(searchParams.get("category")));

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