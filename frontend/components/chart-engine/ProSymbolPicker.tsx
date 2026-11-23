"use client";
// components/chart-engine/ProSymbolPicker.tsx
// Pipflow-style instrument dropdown. The list is exactly what the Exness account serves, read from the Exness API
// (/api/private/instruments/exness): search box, category chips (Forex, Metals, Energy, Indices, Crypto, Stocks).
// If the API list is unavailable it falls back to the small set already verified on Exness (never other brokers' markets).
import { useEffect, useMemo, useRef, useState } from "react";
import { BOARD_INSTRUMENTS } from "@/types/market-board";
import { registerDiscoveredInstrument } from "@/lib/market-data/instrument-catalog";
import { buildExnessCanonical, toExnessDto, EXNESS_GROUPS, EXNESS_GROUP_LABEL, type ExnessGroup, type ExnessInstrumentDto } from "@/lib/market-data/exness-instrument-model";

interface Props {
  value: string;
  onChange: (symbol: string) => void;
}

const FAV_KEY = "at24.chart.favourites";
const MAX_FAVOURITES = 30;

function readFavourites(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string").slice(0, MAX_FAVOURITES) : [];
  } catch {
    return [];
  }
}

const FALLBACK: ExnessInstrumentDto[] = BOARD_INSTRUMENTS.map((b) => ({ ...toExnessDto(b.symbol, b.label), group: b.group === "metals" ? "metals" : b.group === "energy" ? "energy" : b.group === "indices" ? "indices" : b.group === "crypto" ? "crypto" : "forex" }));

export default function ProSymbolPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<ExnessGroup | "all">("all");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ExnessInstrumentDto[]>(FALLBACK);
  const [fromApi, setFromApi] = useState(false);
  const [favourites, setFavourites] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setFavourites(readFavourites()); }, []);

  function toggleFavourite(symbol: string) {
    setFavourites((prev) => {
      const next = prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [symbol, ...prev].slice(0, MAX_FAVOURITES);
      try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* storage can be blocked; the choice then lasts for this page view */ }
      return next;
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/private/instruments/exness", { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        const rows = j?.status === "ok" && Array.isArray(j.data?.instruments) ? (j.data.instruments as ExnessInstrumentDto[]) : [];
        if (rows.length > 0) {
          setList(rows);
          setFromApi(true);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const current = list.find((i) => i.symbol === value);
  const groupsPresent = useMemo(() => EXNESS_GROUPS.filter((g) => list.some((i) => i.group === g)), [list]);
  const q = query.trim().toLowerCase();
  const favItems = favourites.map((s) => list.find((i) => i.symbol === s)).filter((i): i is ExnessInstrumentDto => i !== undefined);
  const isFav = favourites.includes(value);
  const shown = list.filter((i) => (cat === "all" || i.group === cat) && (q === "" || i.symbol.toLowerCase().includes(q) || i.label.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)));

  function pick(item: ExnessInstrumentDto) {
    registerDiscoveredInstrument(buildExnessCanonical(item)); // no-op for symbols the catalog already knows; lets the chart resolve the rest
    onChange(item.symbol);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={boxRef} className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-ink-3 px-3 text-[14px] font-bold text-text hover:border-white/25 sm:gap-2 sm:px-4 sm:text-[15px]"
      >
        <span aria-hidden className="hidden sm:inline">⌕</span>
        {current ? current.label : value}
        <span aria-hidden className="text-text-3">⌄</span>
      </button>
      <button
        type="button"
        onClick={() => toggleFavourite(value)}
        aria-pressed={isFav}
        aria-label={isFav ? `Remove ${value} from favourites` : `Add ${value} to favourites`}
        title={isFav ? "Remove from favourites" : "Add to favourites"}
        className={`flex h-9 w-9 items-center justify-center rounded-full text-[17px] transition hover:bg-ink-4 ${isFav ? "text-gold" : "text-text-3 hover:text-text"}`}
      >
        {isFav ? "★" : "☆"}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[calc(100vw-1rem)] max-w-80 rounded-lg border border-border bg-ink-3 p-3 shadow-2xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pair or instrument"
            aria-label="Search instruments"
            className="w-full rounded-control border border-border bg-ink-3 px-3 py-1.5 text-xs text-text focus:border-gold focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {(["all", ...groupsPresent] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setCat(g)}
                aria-pressed={cat === g}
                className={`rounded-full px-2.5 py-1 text-[11px] ${cat === g ? "bg-gold text-ink" : "bg-ink-3 text-text-3 hover:text-text"}`}
              >
                {g === "all" ? "All" : EXNESS_GROUP_LABEL[g]}
              </button>
            ))}
          </div>
          {favItems.length > 0 && q === "" && cat === "all" && (
            <div className="mt-2">
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-3">Favourites</p>
              <div className="flex flex-wrap gap-1">
                {favItems.map((i) => (
                  <button key={i.symbol} type="button" onClick={() => pick(i)} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${i.symbol === value ? "border-gold/50 bg-gold/10 text-gold" : "border-border text-text-2 hover:bg-ink-4"}`}>{i.label}</button>
                ))}
              </div>
            </div>
          )}
          <ul role="listbox" className="mt-2 max-h-72 overflow-y-auto">
            {shown.map((i) => (
              <li key={i.symbol} className="flex items-center">
                <button
                  type="button"
                  role="option"
                  aria-selected={i.symbol === value}
                  onClick={() => pick(i)}
                  className={`flex min-w-0 flex-1 items-center justify-between rounded-control px-2 py-1.5 text-left text-xs hover:bg-ink-3 ${i.symbol === value ? "bg-ink-3 text-gold" : "text-text-2"}`}
                >
                  <span className="font-medium">{i.label}</span>
                  <span className="truncate pl-3 text-[11px] text-text-3">{i.name === i.symbol ? EXNESS_GROUP_LABEL[i.group] : i.name}</span>
                </button>
                <button type="button" onClick={() => toggleFavourite(i.symbol)} aria-label={favourites.includes(i.symbol) ? `Remove ${i.label} from favourites` : `Add ${i.label} to favourites`} className={`px-2 text-[14px] ${favourites.includes(i.symbol) ? "text-gold" : "text-text-3 hover:text-text"}`}>{favourites.includes(i.symbol) ? "★" : "☆"}</button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-2 text-xs text-text-3">No matching instrument.</li>}
          </ul>
          <p className="mt-2 text-[10px] text-text-3">{fromApi ? `${list.length} instruments from the Exness account` : "Exness list not available right now, showing the core set"}</p>
        </div>
      )}
    </div>
  );
}
