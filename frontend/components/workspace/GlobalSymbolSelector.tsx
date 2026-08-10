"use client";

// components/workspace/GlobalSymbolSelector.tsx
// Sprint D2.3 (Phase 2) - Addition 2. The single symbol control for the whole
// workspace: changing it updates every panel (chart, AI intelligence,
// indicators, evidence, assistant, research) because they all read the shared
// WorkspaceContext.
//
// Sprint D2.6.3 - functional upgrade only (not a redesign, per the sprint's
// own instruction): the fixed <select> over 10 registry-enabled symbols is
// replaced with a real search box over the new GET /api/instruments/search
// endpoint (services/market-data/instrument-search.service.ts), so a trader
// can type "BTC", "Bitcoin", "Gold", "NIFTY", or a provider symbol like
// "BTCUSDT" and get real, ranked, provider-labeled candidates - never a
// fabricated or arbitrarily-picked match. Selecting a result still just
// calls the same WorkspaceContext.setSymbol() every other part of the app
// already relies on; nothing about that contract changes.
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";

interface InstrumentSearchResult {
  id: string;
  symbol: string;
  displayName: string;
  assetClass: string;
  exchange?: string;
  country?: string;
  matchType: string;
  providers: { provider: string; providerSymbol: string; capabilities: string[]; verified: boolean }[];
}

const PROVIDER_LABELS: Record<string, string> = {
  "twelve-data": "Twelve Data",
  "alpha-vantage": "Alpha Vantage",
  binance: "Binance",
  "angel-one": "Angel One",
};

const DEBOUNCE_MS = 200;

export default function GlobalSymbolSelector() {
  const { symbol, setSymbol } = useWorkspace();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InstrumentSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/private/instruments/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((j) => {
          if (j?.status === "ok" && Array.isArray(j.data?.results)) {
            setResults(j.data.results as InstrumentSearchResult[]);
          } else {
            setResults([]);
          }
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function selectResult(result: InstrumentSearchResult) {
    setSymbol(result.id);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wider text-text-3">Symbol</span>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={symbol}
          aria-label="Search symbol or instrument"
          className="w-48 rounded-control border border-border bg-ink-2 px-3 py-1.5 text-sm font-semibold text-text placeholder:text-text-3 focus-visible:border-gold"
        />
        {open && (query.trim().length > 0 || loading) && (
          <ul className="absolute left-0 top-full z-20 mt-1 max-h-80 w-80 overflow-y-auto rounded-control border border-border bg-ink-2 py-1 shadow-lg">
            {loading && <li className="px-3 py-2 text-xs text-text-3">Searching…</li>}
            {!loading && results.length === 0 && query.trim().length > 0 && (
              <li className="px-3 py-2 text-xs text-text-3">No matching instrument found.</li>
            )}
            {!loading &&
              results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => selectResult(result)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-ink-3"
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-text">{result.symbol}</span>
                      <span className="text-[10px] uppercase tracking-wide text-text-3">{result.assetClass}</span>
                    </span>
                    <span className="text-xs text-text-2">{result.displayName}</span>
                    {result.providers.length > 0 ? (
                      <span className="text-[10px] text-text-3">
                        {result.providers.map((p) => PROVIDER_LABELS[p.provider] ?? p.provider).join(", ")}
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-3">No provider currently available</span>
                    )}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
