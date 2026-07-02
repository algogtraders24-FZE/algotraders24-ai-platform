"use client";

import { useState } from "react";
import type { Product } from "@/types/product";

export default function ProductGallery({ product }: { product: Product }) {
  const [active, setActive] = useState(0);
  const images = product.images.length ? product.images : ["/assets/products/placeholder.png"];

  return (
    <section className="px-6 mb-16">
      <div className="max-w-7xl mx-auto">
        <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] aspect-video flex items-center justify-center overflow-hidden">
          {/* Image (falls back to gradient if not found) */}
          <div className="w-full h-full bg-gradient-to-br from-blue-600/20 to-purple-600/20 flex items-center justify-center text-gray-500">
            {product.name} — Preview {active + 1}
          </div>
        </div>

        {images.length > 1 && (
          <div className="flex gap-3 mt-4">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                className={`w-20 h-14 rounded-lg border transition ${
                  active === i ? "border-blue-500" : "border-[#1F2937] hover:border-blue-500"
                } bg-[#0C1324]`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}