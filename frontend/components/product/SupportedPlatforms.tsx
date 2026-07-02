import type { Product } from "@/types/product";

export default function SupportedPlatforms({ product }: { product: Product }) {
  return (
    <section className="px-6 mb-16">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold mb-8">Supported Platforms</h2>
        <div className="flex flex-wrap gap-3">
          {product.supportedPlatforms.map((platform, i) => (
            <span
              key={i}
              className="rounded-xl bg-[#0C1324] border border-[#1F2937] px-5 py-3 font-medium"
            >
              {platform}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}