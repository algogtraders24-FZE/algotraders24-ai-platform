import type { Product } from "@/types/product";
import { PRODUCTS } from "@/data/products";
import ProductCard from "./ProductCard";

export default function RelatedProducts({ product }: { product: Product }) {
  // Same category ke products, khud ko chhodkar, max 3
  const related = PRODUCTS.filter(
    (p) => p.category === product.category && p.id !== product.id
  ).slice(0, 3);

  if (related.length === 0) return null;

  return (
    <section className="px-6 pb-24">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold mb-8">Related Products</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {related.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  );
}