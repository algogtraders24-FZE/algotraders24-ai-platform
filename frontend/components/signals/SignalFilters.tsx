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
            ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
            : "border-slate-800 text-slate-400 hover:border-slate-700"
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
              ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
              : "border-slate-800 text-slate-400 hover:border-slate-700"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}