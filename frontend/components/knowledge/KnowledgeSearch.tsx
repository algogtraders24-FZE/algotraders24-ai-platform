// components/knowledge/KnowledgeSearch.tsx
"use client";

import { useState } from "react";
import type { SearchResult } from "@/types/knowledge";

interface Props {
  onSearch: (query: string) => SearchResult[];
  onOpen: (id: string) => void;
}

export default function KnowledgeSearch({ onSearch, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  const run = () => {
    setResults(onSearch(query));
    setSearched(true);
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
        <button onClick={run} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Search</button>
      </div>

      {searched && (
        <div className="mt-3 space-y-2">
          {results.map((r) => (
            <button key={r.document.id} onClick={() => onOpen(r.document.id)} className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-left hover:border-slate-700">
              <div>
                <p className="text-sm text-slate-200">{r.document.title}</p>
                <p className="text-xs text-slate-500">{r.snippet}</p>
              </div>
              <span className="text-xs font-semibold text-indigo-400">{r.score}%</span>
            </button>
          ))}
          {results.length === 0 && <p className="text-xs text-slate-600">No matching documents.</p>}
        </div>
      )}
    </div>
  );
}