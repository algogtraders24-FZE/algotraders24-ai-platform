// components/news/NewsFilter.tsx
"use client";

import type { NewsCategory } from "@/types/news";
import { NEWS_CATEGORIES } from "@/config/news.config";

interface Props {
  value: NewsCategory | "all";
  onChange: (value: NewsCategory | "all") => void;
}

export default function NewsFilter({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange("all")}
        className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition ${
          value === "all"
            ? "border-gold/40 bg-gold/15 text-gold"
            : "border-border text-text-2 hover:border-border"
        }`}
      >
        All
      </button>
      {NEWS_CATEGORIES.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition ${
            value === c
              ? "border-gold/40 bg-gold/15 text-gold"
              : "border-border text-text-2 hover:border-border"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}