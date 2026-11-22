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

export default function RangeBar({ active, onRange, info, testerOpen, onToggleTester }: { active: RangeKey | null; onRange: (k: RangeKey) => void; info?: string; testerOpen?: boolean; onToggleTester?: () => void }) {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19) + " UTC");
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-t border-border bg-ink-2 px-3 text-[12px]">
      <div role="group" aria-label="Chart range" className="flex items-center gap-1">
        {RANGE_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onRange(k)}
            aria-pressed={active === k}
            className={`rounded-md px-2.5 py-1 font-medium transition ${active === k ? "bg-ink-4 text-text" : "text-text-3 hover:bg-ink-4 hover:text-text"}`}
          >
            {k}
          </button>
        ))}
        {onToggleTester && (
          <button
            type="button"
            onClick={onToggleTester}
            aria-pressed={testerOpen}
            title="Backtest a strategy on this chart"
            className={`ml-3 rounded-md border px-3 py-1 font-semibold transition ${testerOpen ? "border-gold/50 bg-gold/15 text-gold" : "border-border text-text-2 hover:bg-ink-4 hover:text-text"}`}
          >
            Strategy Tester {testerOpen ? "▾" : "▴"}
          </button>
        )}
      </div>
      <span className="flex items-center gap-3 tabular-nums text-text-3">
        {info && <span className="hidden sm:inline">{info}</span>}
        {now}
      </span>
    </div>
  );
}
