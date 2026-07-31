// components/knowledge/KnowledgeDetails.tsx
"use client";

import type { KnowledgeDocument, RetrievalRecord } from "@/types/knowledge";
import { DOC_STATUS_STYLES } from "@/config/knowledge.config";

interface Props {
  doc: KnowledgeDocument | null;
  related: KnowledgeDocument[];
  retrievals: RetrievalRecord[];
  onReindex: (id: string) => void;
}

export default function KnowledgeDetails({ doc, related, retrievals, onReindex }: Props) {
  if (!doc) {
    return <div className="rounded-xl border border-border bg-ink-2 p-6 text-sm text-text-3">Select a document to view details.</div>;
  }

  const kb = (doc.documentSize / 1024).toFixed(1);

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-ink-2 to-ink-2 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-text">{doc.title}</h2>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${DOC_STATUS_STYLES[doc.status]}`}>{doc.status}</span>
      </div>
      <p className="mt-2 text-sm text-text-2">{doc.description}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
        <div><p className="text-text-3">Category</p><p className="text-text">{doc.category}</p></div>
        <div><p className="text-text-3">Collection</p><p className="text-text">{doc.collection}</p></div>
        <div><p className="text-text-3">Author</p><p className="text-text">{doc.author}</p></div>
        <div><p className="text-text-3">Size</p><p className="text-text">{kb} KB</p></div>
        <div><p className="text-text-3">Embedding</p><p className="text-text capitalize">{doc.embeddingStatus}</p></div>
        <div><p className="text-text-3">Retrievals</p><p className="text-text">{doc.retrievalCount}</p></div>
      </div>

      {doc.tags.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-text-2">Tags</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {doc.tags.map((t) => <span key={t} className="rounded-lg bg-ink-3 px-2.5 py-1 text-xs text-text-2">{t}</span>)}
          </div>
        </div>
      )}

      <button onClick={() => onReindex(doc.id)} className="mt-4 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-2 hover:border-border">Re-index</button>

      {related.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-text-2">Related Documents</p>
          <div className="mt-2 space-y-1">
            {related.map((r) => <p key={r.id} className="text-xs text-text-2">• {r.title}</p>)}
          </div>
        </div>
      )}

      {retrievals.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-text-2">Recent Retrievals</p>
          <div className="mt-2 space-y-1">
            {retrievals.slice(0, 4).map((r) => (
              <p key={r.id} className="text-xs text-text-3">"{r.query}" — {r.score}%</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}