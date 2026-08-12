"use client";

// components/workspace/GlobalSymbolSelector.tsx
// Sprint D2.3 (Phase 2) - Addition 2. The single symbol control for the whole
// workspace: changing it updates every panel (chart, AI intelligence,
// indicators, evidence, assistant, research) because they all read the shared
// WorkspaceContext.
//
// Sprint D2.6.3 - functional upgrade only (not a redesign, per the sprint's
// own instruction): the fixed <select> over 10 registry-enabled symbols is
// replaced with a real search box over GET /api/instruments/search, so a
// trader can type "BTC", "Bitcoin", "Gold", "NIFTY", or a provider symbol
// like "BTCUSDT" and get real, ranked, provider-labeled candidates - never
// a fabricated or arbitrarily-picked match. Selecting a result still just
// calls the same WorkspaceContext.setSymbol() every other part of the app
// already relies on; nothing about that contract changes.
//
// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. The same route now also searches live provider discovery when
// the pre-existing catalog alone doesn't answer a query well (see
// UniversalInstrumentDiscoveryService) - this component has NO knowledge
// of that; it only renders whatever the route returns, honoring "never
// hardcode search results into the component." Additive UI only: default/
// popular suggestions before typing (never a hardcoded whitelist - the
// same instruments remain fully searchable, this is just what shows with
// an empty query), a discovery-in-progress hint, per-result quote/candle/
// chart/intelligence availability, and full keyboard navigation.
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";

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

export default function GlobalSymbolSelector() {
  const { symbol, setSymbol } = useWorkspace();
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
    setSymbol(result.id);
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
          onKeyDown={onKeyDown}
          placeholder={symbol}
          aria-label="Search symbol or instrument"
          aria-expanded={open}
          aria-controls="instrument-selector-listbox"
          aria-activedescendant={activeIndex >= 0 ? `instrument-option-${activeIndex}` : undefined}
          role="combobox"
          className="w-48 rounded-control border border-border bg-ink-2 px-3 py-1.5 text-sm font-semibold text-text placeholder:text-text-3 focus-visible:border-gold"
        />
        {open && (
          <ul id="instrument-selector-listbox" role="listbox" className="absolute left-0 top-full z-20 mt-1 max-h-96 w-96 overflow-y-auto rounded-control border border-border bg-ink-2 py-1 shadow-lg">
            {query.trim().length === 0 && (
              <li className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-3">Popular instruments</li>
            )}
            {loading && <li className="px-3 py-2 text-xs text-text-3">Searching…</li>}
            {!loading && discovering && <li className="px-3 py-2 text-xs text-text-3">Checking additional providers…</li>}
            {!loading && query.trim().length > 0 && results.length === 0 && (
              <li className="px-3 py-2 text-xs text-text-3">No matching instrument found.</li>
            )}
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
    </div>
  );
}
