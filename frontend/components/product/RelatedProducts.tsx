// components/product/RelatedProducts.tsx
// Sprint 14E - Related products are now resolved on the server (database) and
// passed in. Markup and styling unchanged.
import type { Product } from "@/types/product";
import ProductCard from "./ProductCard";

export default function RelatedProducts({
  products,
}: {
  products: Product[];
}) {
  if (products.length === 0) return null;

  return (
    <section className="px-6 pb-24">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold mb-8">Related Products</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  );
}