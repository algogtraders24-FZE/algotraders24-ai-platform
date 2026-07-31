// components/knowledge/KnowledgeGrid.tsx
// Sprint R1.1 - Distinguishes a genuinely empty library (no documents
// uploaded at all) from a category filter that just has no matches -
// previously both cases showed the same generic "No documents in this
// view", which left a brand-new user with no clue that uploading is the
// next step.
"use client";

import type { KnowledgeDocument } from "@/types/knowledge";
import KnowledgeCard from "./KnowledgeCard";

export default function KnowledgeGrid({
  docs,
  onOpen,
  totalCount,
}: {
  docs: KnowledgeDocument[];
  onOpen: (id: string) => void;
  totalCount: number;
}) {
  if (docs.length === 0) {
    if (totalCount === 0) {
      return (
        <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center">
          <p className="text-sm font-medium text-slate-300">No documents yet</p>
          <p className="mt-1 text-xs text-slate-600">
            Upload a PDF, DOCX, TXT, or Markdown file below to give the AI Assistant something to reference.
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-600">
        No documents in this category.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {docs.map((d) => <KnowledgeCard key={d.id} doc={d} onOpen={onOpen} />)}
    </div>
  );
}
