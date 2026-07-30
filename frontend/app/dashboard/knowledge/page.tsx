"use client";
// app/dashboard/knowledge/page.tsx
// Sprint 14E - Documents and collections load from PostgreSQL via
// KnowledgeDocumentService.load().
// Sprint L2.2 - Upload, search, and re-index are now real. onUpload calls
// KnowledgeApi.uploadDocument() (real file -> real parse -> real
// IngestionService) and force-reloads the document list from the server
// afterward, instead of hand-patching a local fake record. onSearch is
// async (searchKnowledge now calls the real vector search route).
// onReindex calls the real re-embed route.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KnowledgeDocument } from "@/types/knowledge";
import {
  listDocuments,
  filterByCategory,
  getUsedCategories,
  reindex,
} from "@/services/knowledge/KnowledgeManager";
import { getMetrics, getRelatedDocuments } from "@/services/knowledge/KnowledgeEngine";
import { searchKnowledge } from "@/services/knowledge/KnowledgeSearchService";
import { getRetrievalHistory } from "@/services/knowledge/KnowledgeRetriever";
import {
  getDocumentById,
  getCollections,
  load as loadKnowledge,
} from "@/services/knowledge/KnowledgeDocumentService";
import { KnowledgeApi } from "@/services/api/KnowledgeApi";

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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [category, setCategory] = useState("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setError(null);
    if (reloadKey > 0) setReady(false);

    loadKnowledge({ signal: controller.signal, force: reloadKey > 0 })
      .then(() => {
        if (!active) return;
        const loaded = listDocuments();
        setDocs([...loaded]);
        setActiveId((current) => current ?? loaded[0]?.id ?? null);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Unable to load knowledge base."
        );
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const refresh = useCallback(() => {
    setDocs([...listDocuments()]);
    setTick((t) => t + 1);
  }, []);

  const metrics = useMemo(
    () => (ready ? getMetrics() : null),
    [ready, tick, docs]
  );
  const categories = useMemo(
    () => (ready ? getUsedCategories() : []),
    [ready, tick]
  );
  const collections = useMemo(
    () => (ready ? getCollections() : []),
    [ready, tick]
  );
  const history = useMemo(
    () => (ready ? getRetrievalHistory() : []),
    [ready, tick]
  );
  const visible = useMemo(
    () => (ready ? filterByCategory(category) : []),
    [ready, category, docs]
  );

  const active = activeId ? getDocumentById(activeId) ?? null : null;
  const related = active ? getRelatedDocuments(active) : [];

  const onSearch = useCallback(async (query: string) => {
    const results = await searchKnowledge(query);
    setTick((t) => t + 1); // refresh metrics (searchesToday, avgRetrievalMs)
    return results;
  }, []);

  const onUpload = useCallback(
    async (file: File, uploadCategory: string, collectionId?: string) => {
      setUploading(true);
      setUploadError(null);
      try {
        const result = await KnowledgeApi.uploadDocument({ file, category: uploadCategory, collectionId });
        await loadKnowledge({ force: true });
        setDocs([...listDocuments()]);
        setActiveId(result.document.id);
        setTick((t) => t + 1);
        if (result.document.status === "failed") {
          setUploadError(
            result.chunksCreated === 0
              ? "The document was uploaded but produced no indexable text."
              : "The document was uploaded but embedding failed for every chunk - the embedding provider may be unavailable.",
          );
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const onReindex = useCallback(
    async (id: string) => {
      await reindex(id);
      await loadKnowledge({ force: true });
      refresh();
    },
    [refresh]
  );

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-sm">
            <p className="font-semibold text-red-300">
              Could not load knowledge base
            </p>
            <p className="mt-1 text-slate-400">{error}</p>
            <button
              onClick={retry}
              className="mt-4 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ready || !metrics) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="rounded-2xl border border-slate-800 bg-gradient-to-r from-indigo-600/20 to-purple-600/10 p-6">
            <h1 className="text-2xl font-bold">AI Knowledge Base</h1>
            <p className="mt-1 text-sm text-slate-400">
              Retrieval-augmented knowledge foundation
            </p>
          </header>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl border border-slate-800 bg-slate-900"
              />
            ))}
          </div>
          <div className="h-14 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="h-96 animate-pulse rounded-xl border border-slate-800 bg-slate-900 lg:col-span-2" />
            <div className="h-96 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-slate-800 bg-gradient-to-r from-indigo-600/20 to-purple-600/10 p-6">
          <h1 className="text-2xl font-bold">AI Knowledge Base</h1>
          <p className="mt-1 text-sm text-slate-400">
            Retrieval-augmented knowledge foundation
          </p>
        </header>

        <KnowledgeMetrics metrics={metrics} />
        <KnowledgeSearch onSearch={onSearch} onOpen={setActiveId} />
        <KnowledgeCategories
          categories={categories}
          active={category}
          onSelect={setCategory}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-300">
              Document Library
            </h2>
            <KnowledgeGrid docs={visible} onOpen={setActiveId} />
          </div>
          <div className="space-y-4">
            <KnowledgeDetails
              doc={active}
              related={related}
              retrievals={history}
              onReindex={onReindex}
            />
            <KnowledgeUploader collections={collections} uploading={uploading} error={uploadError} onUpload={onUpload} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <KnowledgeCollections collections={collections} />
          <KnowledgeSources />
        </div>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-300">
            Retrieval History
          </h2>
          <KnowledgeHistory records={history} />
        </section>
      </div>
    </div>
  );
}
