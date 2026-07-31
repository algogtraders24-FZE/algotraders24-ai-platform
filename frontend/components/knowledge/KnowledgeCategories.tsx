// components/knowledge/KnowledgeCategories.tsx
// Sprint D1.0 - Retrofitted onto Card + tokens (indigo active pill -> gold).
"use client";

import Card from "@/components/ui/Card";

interface Props {
  categories: string[];
  active: string;
  onSelect: (category: string) => void;
}

function pill(isActive: boolean): string {
  return `rounded-control border px-3 py-1.5 text-xs transition ${
    isActive ? "border-gold/40 bg-gold/10 text-gold" : "border-border text-text-3 hover:border-gold/40"
  }`;
}

export default function KnowledgeCategories({ categories, active, onSelect }: Props) {
  return (
    <Card padding="sm">
      <p className="mb-3 text-sm font-semibold text-text-2">Categories</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onSelect("all")} className={pill(active === "all")}>
          All
        </button>
        {categories.map((c) => (
          <button key={c} onClick={() => onSelect(c)} className={pill(active === c)}>
            {c}
          </button>
        ))}
      </div>
    </Card>
  );
}
