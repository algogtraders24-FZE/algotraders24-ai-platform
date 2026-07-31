// components/knowledge/KnowledgeCollections.tsx
import type { KnowledgeCollection } from "@/types/knowledge";

export default function KnowledgeCollections({ collections }: { collections: KnowledgeCollection[] }) {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4">
      <p className="mb-3 text-sm font-semibold text-text-2">Collections</p>
      <div className="space-y-2">
        {collections.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-lg bg-ink px-3 py-2">
            <div>
              <p className="text-sm text-text">{c.name}</p>
              <p className="text-xs text-text-3">{c.description}</p>
            </div>
            <span className="text-xs font-semibold text-text-2">{c.documentCount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}