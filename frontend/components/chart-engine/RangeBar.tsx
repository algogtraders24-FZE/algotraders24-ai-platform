"use client";
// components/chart-engine/RangeBar.tsx - bottom range presets of the Pro Chart (1D 5D 1M 3M 6M YTD 1Y ALL) and a UTC clock.
import { useEffect, useState } from "react";

export type RangeKey = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";
export const RANGE_KEYS: readonly RangeKey[] = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "ALL"];

/** Span in ms for a preset, or null for ALL (fit the whole loaded history). */
export function rangeSpanMs(key: RangeKey, nowMs: number): number | null {
  const day = 86_400_000;
  switch (key) {
    case "1D": return day;
    case "5D": return 5 * day;
    case "1M": return 30 * day;
    case "3M": return 90 * day;
    case "6M": return 180 * day;
    case "1Y": return 365 * day;
    case "YTD": return nowMs - Date.UTC(new Date(nowMs).getUTCFullYear(), 0, 1);
    default: return null;
  }
}

export default function RangeBar({ active, onRange }: { active: RangeKey | null; onRange: (k: RangeKey) => void }) {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19) + " UTC");
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/[0.06] bg-[#0d0e12] px-3 text-[12px]">
      <div role="group" aria-label="Chart range" className="flex items-center gap-1">
        {RANGE_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onRange(k)}
            aria-pressed={active === k}
            className={`rounded-md px-2.5 py-1 font-medium transition ${active === k ? "bg-white/[0.12] text-white" : "text-[#9aa0ae] hover:bg-white/[0.07] hover:text-white"}`}
          >
            {k}
          </button>
        ))}
      </div>
      <span className="tabular-nums text-[#6b7280]">{now}</span>
    </div>
  );
}
