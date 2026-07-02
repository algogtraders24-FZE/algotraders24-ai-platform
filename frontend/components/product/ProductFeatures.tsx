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
              className="flex items-start gap-3 rounded-xl bg-[#0C1324] border border-[#1F2937] p-5"
            >
              <span className="text-blue-400 mt-0.5">✓</span>
              <span className="text-gray-300">{feature}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}