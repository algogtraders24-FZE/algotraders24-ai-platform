// components/knowledge/KnowledgeCollections.tsx
// Sprint UI-03 - hand-rolled rounded-xl recipe -> Card (padding="sm" is the
// same p-4). Inner rows stay as their own dense list-row markup - already
// token-correct, not page-scale cards themselves.
import type { KnowledgeCollection } from "@/types/knowledge";
import Card from "@/components/ui/Card";

export default function KnowledgeCollections({ collections }: { collections: KnowledgeCollection[] }) {
  return (
    <Card padding="sm">
      <p className="mb-3 text-sm font-semibold text-text-2">Collections</p>
      <div className="space-y-2">
        {collections.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-control bg-ink px-3 py-2">
            <div>
              <p className="text-sm text-text">{c.name}</p>
              <p className="text-xs text-text-3">{c.description}</p>
            </div>
            <span className="text-xs font-semibold text-text-2">{c.documentCount}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}