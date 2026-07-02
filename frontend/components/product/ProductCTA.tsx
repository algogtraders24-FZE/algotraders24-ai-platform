import type { Product } from "@/types/product";

export default function ProductCTA({ product }: { product: Product }) {
  return (
    <section className="px-6 mb-16">
      <div className="max-w-7xl mx-auto">
        <div className="rounded-3xl bg-gradient-to-r from-blue-600 to-purple-700 p-10 md:p-14 text-center">
          <h2 className="text-2xl md:text-4xl font-bold">Get {product.name} Today</h2>
          <p className="text-blue-100 mt-3">
            Instant download • Lifetime updates • Priority support
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <button className="bg-white text-blue-700 hover:bg-gray-100 px-8 py-4 rounded-xl font-semibold transition">
              Buy Now — ${product.price}
            </button>
            <button className="border border-white/40 hover:border-white px-8 py-4 rounded-xl font-semibold transition">
              Request Demo
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}