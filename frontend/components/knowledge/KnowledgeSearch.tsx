// components/knowledge/KnowledgeSearch.tsx
// Sprint L2.2 - onSearch is now async (the real vector search route).
// Sprint D1.0 - Retrofitted onto Card/Input/Button + tokens (indigo-600
// button/indigo-400 score -> gold, slate chrome -> ink/text).
"use client";

import { useState } from "react";
import type { SearchResult } from "@/types/knowledge";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

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
    <Card padding="sm">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Search the knowledge base..."
          className="flex-1"
        />
        <Button onClick={run} loading={loading}>
          {loading ? "Searching…" : "Search"}
        </Button>
      </div>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      {searched && !error && (
        <div className="mt-3 space-y-2">
          {results.map((r) => (
            <button
              key={r.chunkId}
              onClick={() => onOpen(r.document.id)}
              className="flex w-full items-center justify-between gap-3 rounded-control border border-border bg-ink px-3 py-2 text-left transition hover:border-gold/40"
            >
              <div className="min-w-0">
                <p className="text-sm text-text">{r.document.title}</p>
                <p className="truncate text-xs text-text-3">{r.snippet}</p>
                <p className="mt-0.5 font-mono text-[10px] text-text-3">chunk #{r.chunkIndex}</p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-gold">{r.score}%</span>
            </button>
          ))}
          {results.length === 0 && <p className="text-xs text-text-3">No matching documents.</p>}
        </div>
      )}
    </Card>
  );
}
