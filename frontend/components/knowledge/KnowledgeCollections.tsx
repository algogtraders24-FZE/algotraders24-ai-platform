// components/knowledge/KnowledgeCollections.tsx
import type { KnowledgeCollection } from "@/types/knowledge";

export default function KnowledgeCollections({ collections }: { collections: KnowledgeCollection[] }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Collections</p>
      <div className="space-y-2">
        {collections.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-lg bg-slate-950/40 px-3 py-2">
            <div>
              <p className="text-sm text-slate-200">{c.name}</p>
              <p className="text-xs text-slate-500">{c.description}</p>
            </div>
            <span className="text-xs font-semibold text-slate-400">{c.documentCount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}