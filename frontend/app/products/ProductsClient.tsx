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
//
// Sprint D2.4.A5 - replaced useSearchParams() (which requires a Suspense
// boundary) with a plain useEffect reading window.location.search after
// mount. A direct/cold page load to /products was found to render nothing
// past the hero - the Suspense boundary around this component would
// suspend on hydration and never recover, discarding the real,
// server-rendered product grid entirely (confirmed via curl: the SSR HTML
// has every product; the hydrated DOM had none). Reading the query string
// in an effect needs no Suspense boundary at all, so this removes the bug
// at its source rather than papering over the symptom with a Suspense
// fallback skeleton that would only ever be a dead end. The one-tick delay
// before a ?category= deep-link applies is an acceptable tradeoff against
// the previous "sometimes shows nothing at all" failure mode.
import { useEffect, useState } from "react";
import { CATEGORIES } from "@/data/categories";
import CategoryFilter from "@/components/product/CategoryFilter";
import ProductGrid from "@/components/product/ProductGrid";
import type { Product, ProductCategoryId } from "@/types/product";

function categoryFromParam(param: string | null): ProductCategoryId | "all" {
  if (param && CATEGORIES.some((c) => c.id === param)) return param as ProductCategoryId;
  return "all";
}

export default function ProductsClient({ products }: { products: Product[] }) {
  const [active, setActive] = useState<ProductCategoryId | "all">("all");

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("category");
    const category = categoryFromParam(param);
    if (category !== "all") setActive(category);
  }, []);

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
