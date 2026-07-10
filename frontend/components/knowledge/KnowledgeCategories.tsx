// components/knowledge/KnowledgeCategories.tsx
"use client";

interface Props {
  categories: string[];
  active: string;
  onSelect: (category: string) => void;
}

export default function KnowledgeCategories({ categories, active, onSelect }: Props) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Categories</p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onSelect("all")}
          className={`rounded-lg border px-3 py-1.5 text-xs transition ${active === "all" ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300" : "border-slate-800 text-slate-400 hover:border-slate-700"}`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => onSelect(c)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${active === c ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300" : "border-slate-800 text-slate-400 hover:border-slate-700"}`}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}