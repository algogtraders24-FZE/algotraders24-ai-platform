// components/signals/MarketSelector.tsx
"use client";

import type { MarketCategory } from "@/types/market";
import { SUPPORTED_MARKETS } from "@/config/signal.config";

interface Props {
  value: MarketCategory | "all";
  onChange: (value: MarketCategory | "all") => void;
}

export default function MarketSelector({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange("all")}
        className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition ${
          value === "all"
            ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
            : "border-slate-800 text-slate-400 hover:border-slate-700"
        }`}
      >
        All
      </button>
      {SUPPORTED_MARKETS.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition ${
            value === m
              ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
              : "border-slate-800 text-slate-400 hover:border-slate-700"
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}