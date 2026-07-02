import type { Product } from "@/types/product";

export default function ProductSpecifications({ product }: { product: Product }) {
  return (
    <section className="px-6 mb-16">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold mb-8">Technical Specifications</h2>
        <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] overflow-hidden">
          {product.specifications.map((spec, i) => (
            <div
              key={i}
              className="flex justify-between px-6 py-4 border-b border-[#1F2937] last:border-b-0"
            >
              <span className="text-gray-400">{spec.label}</span>
              <span className="font-medium">{spec.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}