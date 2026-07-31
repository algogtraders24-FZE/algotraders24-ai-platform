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
            ? "border-gold/40 bg-gold/15 text-gold"
            : "border-border text-text-2 hover:border-border"
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
              ? "border-gold/40 bg-gold/15 text-gold"
              : "border-border text-text-2 hover:border-border"
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}