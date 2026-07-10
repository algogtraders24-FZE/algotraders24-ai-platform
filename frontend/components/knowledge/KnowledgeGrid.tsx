// components/knowledge/KnowledgeGrid.tsx
"use client";

import type { KnowledgeDocument } from "@/types/knowledge";
import KnowledgeCard from "./KnowledgeCard";

export default function KnowledgeGrid({ docs, onOpen }: { docs: KnowledgeDocument[]; onOpen: (id: string) => void }) {
  if (docs.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-600">No documents in this view.</div>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {docs.map((d) => <KnowledgeCard key={d.id} doc={d} onOpen={onOpen} />)}
    </div>
  );
}