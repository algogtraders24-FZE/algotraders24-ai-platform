import type { Product } from "@/types/product";

export default function ProductFeatures({ product }: { product: Product }) {
  return (
    <section className="px-6 mb-16">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold mb-8">Key Features</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {product.features.map((feature, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-xl bg-ink-2 border border-border p-5"
            >
              <span className="text-gold mt-0.5">✓</span>
              <span className="text-text-2">{feature}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}