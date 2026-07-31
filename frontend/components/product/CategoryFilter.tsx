"use client";

import { CATEGORIES } from "@/data/categories";
import type { ProductCategoryId } from "@/types/product";

interface CategoryFilterProps {
  active: ProductCategoryId | "all";
  onChange: (category: ProductCategoryId | "all") => void;
}

export default function CategoryFilter({ active, onChange }: CategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-3 justify-center">
      <button
        onClick={() => onChange("all")}
        className={`px-4 py-2 rounded-full text-sm font-semibold transition border ${
          active === "all"
            ? "bg-gold border-gold text-ink"
            : "bg-ink-2 border-border text-text-2 hover:border-gold"
        }`}
      >
        All Products
      </button>

      {CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onChange(cat.id)}
          className={`px-4 py-2 rounded-full text-sm font-semibold transition border ${
            active === cat.id
              ? "bg-gold border-gold text-ink"
              : "bg-ink-2 border-border text-text-2 hover:border-gold"
          }`}
        >
          {cat.shortName}
        </button>
      ))}
    </div>
  );
}