// components/signals/SignalFilters.tsx
"use client";

import type { SignalDirection } from "@/types/signal";
import { SIGNAL_TYPES } from "@/config/signal.config";

interface Props {
  value: SignalDirection | "all";
  onChange: (value: SignalDirection | "all") => void;
}

export default function SignalFilters({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange("all")}
        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
          value === "all"
            ? "border-gold/40 bg-gold/15 text-gold"
            : "border-border text-text-2 hover:border-border"
        }`}
      >
        All
      </button>
      {SIGNAL_TYPES.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            value === t
              ? "border-gold/40 bg-gold/15 text-gold"
              : "border-border text-text-2 hover:border-border"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}