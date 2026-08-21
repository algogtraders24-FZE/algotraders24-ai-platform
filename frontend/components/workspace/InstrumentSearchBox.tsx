"use client";

// components/workspace/InstrumentSearchBox.tsx
// Sprint D2.7.11 Phase 3 - extracted from GlobalSymbolSelector.tsx so a
// chart pane's own independent symbol search (multi-symbol tiled layout)
// can reuse the EXACT same real search/keyboard-nav/discovery behavior
// (GET /api/private/instruments/search, ranked provider-labeled results,
// never a fabricated or arbitrarily-picked match) instead of a second,
// drifting implementation. GlobalSymbolSelector is now a thin wrapper:
// `value`/`onChange` are the only new surface - everything else (default
// suggestions, debounce, discovery-in-progress hint, capability badges,
// full keyboard navigation) is byte-identical to what GlobalSymbolSelector
// always did, just no longer hardcoded to WorkspaceContext.
import { useEffect, useRef, useState } from "react";

interface InstrumentCapabilities {
  quote: boolean;
  candles: boolean;
  intelligence: boolean;
  chart: boolean;
}

interface InstrumentSearchResult {
  id: string;
  symbol: string;
  displayName: string;
  assetClass: string;
  marketCategory?: string;
  exchange?: string;
  country?: string;
  matchType: string;
  discoverySource?: string;
  providers: { provider: string; providerSymbol: string; capabilities: string[]; verified: boolean }[];
  capabilities?: InstrumentCapabilities;
  chart?: { supported: boolean; chartSymbol?: string; reason?: string };
}

const PROVIDER_LABELS: Record<string, string> = {
  "twelve-data": "Twelve Data",
  "alpha-vantage": "Alpha Vantage",
  binance: "Binance",
  "angel-one": "Angel One",
};

// Sprint D2.6.12 - shown ONLY when the search box is empty, as a starting
// point (never a whitelist - any other instrument any configured provider
// can discover remains fully searchable). Mirrors MarketRibbon's own
// already-curated "popular" set rather than inventing a second list.
const DEFAULT_SUGGESTION_IDS = ["EURUSD", "XAUUSD", "BTCUSD", "ETHUSD", "NIFTY50", "BANKNIFTY", "RELIANCE"];

const DEBOUNCE_MS = 200;

export interface InstrumentSearchBoxProps {
  value: string;
  onChange: (symbol: string) => void;
  /** Sprint D2.7.11 Phase 3 - a chart pane's own inline search box has no room for GlobalSymbolSelector's "Symbol" label or its full 48-width input; this narrows both without touching the shared search/keyboard-nav logic. */
  compact?: boolean;
}

export default function InstrumentSearchBox({ value, onChange, compact = false }: InstrumentSearchBoxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InstrumentSearchResult[]>([]);
  const [defaults, setDefaults] = useState<InstrumentSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Default/popular suggestions, fetched once - real catalog entries via
  // the same search route (exact-canonical match for each), never a
  // separate hardcoded result shape.
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      DEFAULT_SUGGESTION_IDS.map((id) =>
        fetch(`/api/private/instruments/search?q=${encodeURIComponent(id)}&limit=1`, { signal: controller.signal })
          .then((r) => r.json())
          .then((j) => (j?.status === "ok" && Array.isArray(j.data?.results) ? (j.data.results[0] as InstrumentSearchResult | undefined) : undefined))
          .catch(() => undefined),
      ),
    ).then((found) => setDefaults(found.filter((r): r is InstrumentSearchResult => r !== undefined)));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    setActiveIndex(-1);
    if (trimmed.length === 0) {
      setResults([]);
      setLoading(false);
      setDiscovering(false);
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
            setDiscovering(j.data.discoveryTriggered === true);
          } else {
            setResults([]);
            setDiscovering(false);
          }
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setResults([]);
          setDiscovering(false);
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

  const visible = query.trim().length > 0 ? results : defaults;

  function selectResult(result: InstrumentSearchResult) {
    onChange(result.id);
    setQuery("");
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || visible.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % visible.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? visible.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0 && activeIndex < visible.length) {
      e.preventDefault();
      selectResult(visible[activeIndex]);
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={value}
        aria-label="Search symbol or instrument"
        aria-expanded={open}
        aria-controls="instrument-selector-listbox"
        aria-activedescendant={activeIndex >= 0 ? `instrument-option-${activeIndex}` : undefined}
        role="combobox"
        className={`rounded-control border border-border bg-ink-2 px-3 py-1.5 text-sm font-semibold text-text placeholder:text-text-3 focus-visible:border-gold ${compact ? "w-28" : "w-48"}`}
      />
      {open && (
        <ul id="instrument-selector-listbox" role="listbox" className="absolute left-0 top-full z-20 mt-1 max-h-96 w-96 overflow-y-auto rounded-control border border-border bg-ink-2 py-1 shadow-lg">
          {query.trim().length === 0 && <li className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-3">Popular instruments</li>}
          {loading && <li className="px-3 py-2 text-xs text-text-3">Searching…</li>}
          {!loading && discovering && <li className="px-3 py-2 text-xs text-text-3">Checking additional providers…</li>}
          {!loading && query.trim().length > 0 && results.length === 0 && <li className="px-3 py-2 text-xs text-text-3">No matching instrument found.</li>}
          {!loading &&
            visible.map((result, i) => {
              const cap = result.capabilities;
              return (
                <li key={result.id} id={`instrument-option-${i}`} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    onClick={() => selectResult(result)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left ${i === activeIndex ? "bg-ink-3" : "hover:bg-ink-3"}`}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-text">{result.symbol}</span>
                      <span className="flex items-center gap-1.5">
                        {result.exchange && <span className="text-[10px] uppercase tracking-wide text-text-3">{result.exchange}</span>}
                        <span className="text-[10px] uppercase tracking-wide text-text-3">{result.assetClass}</span>
                      </span>
                    </span>
                    <span className="text-xs text-text-2">{result.displayName}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-text-3">
                      {result.providers.length > 0 ? (
                        <span>{result.providers.map((p) => PROVIDER_LABELS[p.provider] ?? p.provider).join(", ")}</span>
                      ) : (
                        <span>No provider currently available</span>
                      )}
                      {result.discoverySource && <span className="text-gold/70">discovered</span>}
                      {cap && (
                        <span className="flex items-center gap-1.5">
                          <span className={cap.chart ? "text-signal-up" : "text-text-3"}>Chart {cap.chart ? "✓" : "✗"}</span>
                          <span className={cap.intelligence ? "text-signal-up" : "text-text-3"}>Intelligence {cap.intelligence ? "✓" : "✗"}</span>
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
