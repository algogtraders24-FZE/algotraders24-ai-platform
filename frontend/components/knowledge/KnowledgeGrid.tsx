// components/knowledge/KnowledgeGrid.tsx
// Sprint R1.1 - Distinguishes a genuinely empty library from a category
// filter that just has no matches.
// Sprint D1.0 - Retrofitted onto EmptyState + tokens.
"use client";

import type { KnowledgeDocument } from "@/types/knowledge";
import KnowledgeCard from "./KnowledgeCard";
import EmptyState from "@/components/ui/EmptyState";

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
        <EmptyState
          title="No documents yet"
          description="Upload a PDF, DOCX, TXT, or Markdown file below to give the AI Assistant something to reference."
        />
      );
    }
    return <EmptyState title="No documents in this category." />;
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {docs.map((d) => <KnowledgeCard key={d.id} doc={d} onOpen={onOpen} />)}
    </div>
  );
}
