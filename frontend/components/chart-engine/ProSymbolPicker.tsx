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

const FALLBACK: ExnessInstrumentDto[] = BOARD_INSTRUMENTS.map((b) => ({ ...toExnessDto(b.symbol, b.label), group: b.group === "metals" ? "metals" : b.group === "energy" ? "energy" : b.group === "indices" ? "indices" : b.group === "crypto" ? "crypto" : "forex" }));

export default function ProSymbolPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<ExnessGroup | "all">("all");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ExnessInstrumentDto[]>(FALLBACK);
  const [fromApi, setFromApi] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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
  const shown = list.filter((i) => (cat === "all" || i.group === cat) && (q === "" || i.symbol.toLowerCase().includes(q) || i.label.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)));

  function pick(item: ExnessInstrumentDto) {
    registerDiscoveredInstrument(buildExnessCanonical(item)); // no-op for symbols the catalog already knows; lets the chart resolve the rest
    onChange(item.symbol);
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
        {current ? current.label : value}
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
          <ul role="listbox" className="mt-2 max-h-72 overflow-y-auto">
            {shown.map((i) => (
              <li key={i.symbol}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i.symbol === value}
                  onClick={() => pick(i)}
                  className={`flex w-full items-center justify-between rounded-control px-2 py-1.5 text-left text-xs hover:bg-ink-3 ${i.symbol === value ? "bg-ink-3 text-gold" : "text-text-2"}`}
                >
                  <span className="font-medium">{i.label}</span>
                  <span className="truncate pl-3 text-[11px] text-text-3">{i.name === i.symbol ? EXNESS_GROUP_LABEL[i.group] : i.name}</span>
                </button>
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
