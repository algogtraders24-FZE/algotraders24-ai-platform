// components/knowledge/KnowledgeCard.tsx
"use client";

import type { KnowledgeDocument } from "@/types/knowledge";
import { DOC_STATUS_STYLES } from "@/config/knowledge.config";

export default function KnowledgeCard({ doc, onOpen }: { doc: KnowledgeDocument; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(doc.id)} className="w-full rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-left transition hover:border-slate-700">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100">{doc.title}</h3>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${DOC_STATUS_STYLES[doc.status]}`}>{doc.status}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500 line-clamp-2">{doc.description}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded bg-slate-800/60 px-2 py-0.5">{doc.category}</span>
        <span className="rounded bg-slate-800/60 px-2 py-0.5">{doc.retrievalCount} retrievals</span>
        <span className="rounded bg-slate-800/60 px-2 py-0.5">{doc.fileType}</span>
      </div>
    </button>
  );
}