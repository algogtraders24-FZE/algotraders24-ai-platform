// components/knowledge/KnowledgeSearch.tsx
// Sprint L2.2 - onSearch is now async (the real vector search route) - a
// real loading state and a real per-search error message replace what was
// previously an instant, synchronous mock call.
"use client";

import { useState } from "react";
import type { SearchResult } from "@/types/knowledge";

interface Props {
  onSearch: (query: string) => Promise<SearchResult[]>;
  onOpen: (id: string) => void;
}

export default function KnowledgeSearch({ onSearch, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const found = await onSearch(query);
      setResults(found);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search could not be completed");
      setSearched(true);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Search the knowledge base..."
          className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
        />
        <button
          onClick={run}
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      {searched && !error && (
        <div className="mt-3 space-y-2">
          {results.map((r) => (
            <button
              key={r.chunkId}
              onClick={() => onOpen(r.document.id)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-left hover:border-slate-700"
            >
              <div className="min-w-0">
                <p className="text-sm text-slate-200">{r.document.title}</p>
                <p className="truncate text-xs text-slate-500">{r.snippet}</p>
                <p className="mt-0.5 font-mono text-[10px] text-slate-600">chunk #{r.chunkIndex}</p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-indigo-400">{r.score}%</span>
            </button>
          ))}
          {results.length === 0 && <p className="text-xs text-slate-600">No matching documents.</p>}
        </div>
      )}
    </div>
  );
}
