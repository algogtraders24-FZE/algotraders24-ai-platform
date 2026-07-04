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
            ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
            : "border-slate-800 text-slate-400 hover:border-slate-700"
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
              ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
              : "border-slate-800 text-slate-400 hover:border-slate-700"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}