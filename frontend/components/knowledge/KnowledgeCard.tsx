// components/knowledge/KnowledgeCard.tsx
// Sprint D1.0 - Retrofitted onto tokens (slate chrome -> ink/border/text).
// DOC_STATUS_STYLES is left as-is (real per-status coloring from config).
"use client";

import type { KnowledgeDocument } from "@/types/knowledge";
import { DOC_STATUS_STYLES } from "@/config/knowledge.config";

export default function KnowledgeCard({ doc, onOpen }: { doc: KnowledgeDocument; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(doc.id)} className="w-full rounded-card border border-border bg-ink-2 p-4 text-left transition hover:border-gold/40">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{doc.title}</h3>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${DOC_STATUS_STYLES[doc.status]}`}>{doc.status}</span>
      </div>
      <p className="mt-1 text-xs text-text-3 line-clamp-2">{doc.description}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-3">
        <span className="rounded bg-ink-3 px-2 py-0.5">{doc.category}</span>
        <span className="rounded bg-ink-3 px-2 py-0.5">{doc.retrievalCount} retrievals</span>
        <span className="rounded bg-ink-3 px-2 py-0.5">{doc.fileType}</span>
      </div>
    </button>
  );
}
