"use client";

import { useMemo, useState } from "react";
import type { KnowledgeDocument } from "@/types/knowledge";
import { listDocuments, filterByCategory, getUsedCategories, uploadDocument, reindex } from "@/services/knowledge/KnowledgeManager";
import { getMetrics, getRelatedDocuments } from "@/services/knowledge/KnowledgeEngine";
import { searchKnowledge } from "@/services/knowledge/KnowledgeSearchService";
import { getCollections } from "@/services/knowledge/KnowledgeCollectionService";
import { getRetrievalHistory } from "@/services/knowledge/KnowledgeRetriever";
import { getDocumentById } from "@/services/knowledge/KnowledgeDocumentService";
import KnowledgeMetrics from "@/components/knowledge/KnowledgeMetrics";
import KnowledgeSearch from "@/components/knowledge/KnowledgeSearch";
import KnowledgeCategories from "@/components/knowledge/KnowledgeCategories";
import KnowledgeGrid from "@/components/knowledge/KnowledgeGrid";
import KnowledgeDetails from "@/components/knowledge/KnowledgeDetails";
import KnowledgeCollections from "@/components/knowledge/KnowledgeCollections";
import KnowledgeHistory from "@/components/knowledge/KnowledgeHistory";
import KnowledgeUploader from "@/components/knowledge/KnowledgeUploader";
import KnowledgeSources from "@/components/knowledge/KnowledgeSources";

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDocument[]>(listDocuments());
  const [category, setCategory] = useState("all");
  const [activeId, setActiveId] = useState<string | null>(docs[0]?.id ?? null);
  const [tick, setTick] = useState(0);

  const refresh = () => { setDocs([...listDocuments()]); setTick((t) => t + 1); };

  const metrics = useMemo(() => getMetrics(), [tick, docs]);
  const categories = useMemo(() => getUsedCategories(), [tick]);
  const collections = useMemo(() => getCollections(), [tick]);
  const history = useMemo(() => getRetrievalHistory(), [tick]);

  const visible = useMemo(() => filterByCategory(category), [category, docs]);
  const active = activeId ? getDocumentById(activeId) ?? null : null;
  const related = active ? getRelatedDocuments(active) : [];

  const onUpload = (title: string, cat: string, col: string) => {
    const doc = uploadDocument(title, cat, col);
    setActiveId(doc.id);
    refresh();
  };

  const onReindex = async (id: string) => { await reindex(id); refresh(); };

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-slate-800 bg-gradient-to-r from-indigo-600/20 to-purple-600/10 p-6">
          <h1 className="text-2xl font-bold">AI Knowledge Base</h1>
          <p className="mt-1 text-sm text-slate-400">Retrieval-augmented knowledge foundation - mock data</p>
        </header>

        <KnowledgeMetrics metrics={metrics} />
        <KnowledgeSearch onSearch={searchKnowledge} onOpen={setActiveId} />
        <KnowledgeCategories categories={categories} active={category} onSelect={setCategory} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-300">Document Library</h2>
            <KnowledgeGrid docs={visible} onOpen={setActiveId} />
          </div>
          <div className="space-y-4">
            <KnowledgeDetails doc={active} related={related} retrievals={history} onReindex={onReindex} />
            <KnowledgeUploader onUpload={onUpload} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <KnowledgeCollections collections={collections} />
          <KnowledgeSources />
        </div>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Retrieval History</h2>
          <KnowledgeHistory records={history} />
        </section>
      </div>
    </div>
  );
}
