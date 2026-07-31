"use client";

import { useState } from "react";
import type { Product } from "@/types/product";

export default function ProductGallery({ product }: { product: Product }) {
  const [active, setActive] = useState(0);
  const images = product.images.length ? product.images : ["/assets/products/placeholder.png"];

  return (
    <section className="px-6 mb-16">
      <div className="max-w-7xl mx-auto">
        <div className="rounded-2xl bg-ink-2 border border-border aspect-video flex items-center justify-center overflow-hidden">
          {/* Image (falls back to gradient if not found) */}
          <div className="w-full h-full bg-gradient-to-br from-gold/20 to-gold/20 flex items-center justify-center text-text-3">
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
                  active === i ? "border-gold" : "border-border hover:border-gold"
                } bg-ink-2`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}