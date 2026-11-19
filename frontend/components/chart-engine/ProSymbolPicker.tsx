"use client";
// components/chart-engine/ProSymbolPicker.tsx
// Pipflow-style instrument dropdown: a pill showing the active pair, opening a panel with a search box,
// category chips and the list of instruments the platform can actually chart today (the market registry's
// enabled markets). Anything not in the list stays reachable through the search box, which uses the same
// /api/private/instruments/search route as the classic selector, so no instrument is ever invented here.
import { useEffect, useMemo, useRef, useState } from "react";
import { listEnabledMarkets } from "@/lib/market-data/market-registry";
import type { MarketDefinition } from "@/lib/market-data/market-registry";

interface Props {
  value: string;
  onChange: (symbol: string) => void;
}

const CATEGORIES: { key: string; label: string; match: (m: MarketDefinition) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "forex", label: "Forex", match: (m) => m.assetClass === "forex" },
  { key: "crypto", label: "Crypto", match: (m) => m.assetClass === "crypto" },
  { key: "metals", label: "Metals", match: (m) => m.assetClass === "commodities" },
  { key: "indices", label: "Indices", match: (m) => m.assetClass === "indices" },
  { key: "stocks", label: "Stocks", match: (m) => m.assetClass === "stocks" },
];

interface SearchHit { id: string; symbol: string; displayName: string; assetClass: string }

function pretty(m: MarketDefinition): string {
  return m.baseCurrency.length <= 4 && m.quoteCurrency.length <= 4 ? `${m.baseCurrency}/${m.quoteCurrency}` : m.symbol;
}

export default function ProSymbolPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState("all");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const markets = useMemo(() => listEnabledMarkets(), []);
  const current = markets.find((m) => m.symbol === value);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/private/instruments/search?q=${encodeURIComponent(q)}&limit=12`, { signal: controller.signal })
        .then((r) => r.json())
        .then((j) => setHits(j?.status === "ok" && Array.isArray(j.data?.results) ? (j.data.results as SearchHit[]) : []))
        .catch(() => setHits([]));
    }, 200);
    return () => { clearTimeout(t); controller.abort(); };
  }, [query]);

  const matcher = CATEGORIES.find((c) => c.key === cat) ?? CATEGORIES[0];
  const q = query.trim().toLowerCase();
  const list = markets.filter((m) => matcher.match(m) && (q === "" || m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)));
  const extra = hits.filter((h) => !markets.some((m) => m.symbol === h.id));

  function pick(symbol: string) {
    onChange(symbol);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-2 rounded-full border border-border bg-ink-3 px-4 py-1.5 text-sm font-semibold text-text hover:border-gold/50"
      >
        <span aria-hidden>⌕</span>
        {current ? pretty(current) : value}
        <span aria-hidden className="text-text-3">⌄</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-panel border border-border bg-ink-2 p-3 shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pair or instrument"
            aria-label="Search instruments"
            className="w-full rounded-control border border-border bg-ink-3 px-3 py-1.5 text-xs text-text focus:border-gold focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCat(c.key)}
                aria-pressed={cat === c.key}
                className={`rounded-full px-2.5 py-1 text-[11px] ${cat === c.key ? "bg-gold text-ink" : "bg-ink-3 text-text-3 hover:text-text"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <ul role="listbox" className="mt-2 max-h-72 overflow-y-auto">
            {list.map((m) => (
              <li key={m.symbol}>
                <button
                  type="button"
                  role="option"
                  aria-selected={m.symbol === value}
                  onClick={() => pick(m.symbol)}
                  className={`flex w-full items-center justify-between rounded-control px-2 py-1.5 text-left text-xs hover:bg-ink-3 ${m.symbol === value ? "bg-ink-3 text-gold" : "text-text-2"}`}
                >
                  <span className="font-medium">{pretty(m)}</span>
                  <span className="truncate pl-3 text-[11px] text-text-3">{m.name}</span>
                </button>
              </li>
            ))}
            {extra.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => pick(h.id)} className="flex w-full items-center justify-between rounded-control px-2 py-1.5 text-left text-xs text-text-2 hover:bg-ink-3">
                  <span className="font-medium">{h.symbol}</span>
                  <span className="truncate pl-3 text-[11px] text-text-3">{h.displayName}</span>
                </button>
              </li>
            ))}
            {list.length === 0 && extra.length === 0 && <li className="px-2 py-2 text-xs text-text-3">No matching instrument.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
