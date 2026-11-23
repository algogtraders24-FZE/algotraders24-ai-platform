"use client";
// components/chart-engine/SignalLog.tsx
// "My signals": the trade plans the Pro Chart generated for this user and what became of each one, measured on the candles that came after
// (target first, stop first, cancelled, expired). Plain numbers with the sample size; nothing is extrapolated and nothing is promised.
import { useCallback, useEffect, useState } from "react";
import type { SignalSummary } from "@/lib/chart-engine/signals/stats";

interface SignalView { id: string; symbol: string; timeframe: string; dir: string; entryType: string; entry: number; stop: number; target: number; rr: number; status: string; resultR: number | null; createdAt: string }
interface Mine { signals: SignalView[]; summary: SignalSummary }

const CHIP: Record<string, { label: string; cls: string }> = {
  target: { label: "Target hit", cls: "bg-green-500/15 text-green-400" },
  stop: { label: "Stop hit", cls: "bg-red-500/15 text-red-400" },
  expired: { label: "Closed at market", cls: "bg-ink-4 text-text-2" },
  cancelled: { label: "Cancelled", cls: "bg-ink-4 text-text-3" },
  unfilled: { label: "Not filled", cls: "bg-ink-4 text-text-3" },
  live: { label: "Live", cls: "bg-gold/15 text-gold" },
  open: { label: "Waiting for entry", cls: "bg-gold/10 text-gold" },
};

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);
const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(2) : Math.abs(n) >= 10 ? n.toFixed(3) : n.toFixed(5));

export function SummaryLine({ s }: { s: SignalSummary }) {
  if (s.total === 0) return <p className="text-text-3">No signals recorded yet. Run Analyze; every trade plan it generates is saved here and followed on the candles that come next.</p>;
  return (
    <div className="space-y-1">
      <p className="text-text">
        {s.total} signal{s.total === 1 ? "" : "s"} · {s.closed} finished · <span className="text-green-400">{s.target} target</span> · <span className="text-red-400">{s.stop} stop</span>
        {s.expired > 0 ? ` · ${s.expired} closed at market` : ""} · {s.open + s.live} running{s.cancelled + s.unfilled > 0 ? ` · ${s.cancelled + s.unfilled} never entered` : ""}
      </p>
      {s.closed > 0 && (
        <p className="text-text-2">
          Target reached first in {pct(s.targetShare)} of finished trades (break-even at their reward:risk is {pct(s.breakEvenShare)}); average result {s.avgR === null ? "n/a" : `${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)} R`}.
        </p>
      )}
      <p className="text-[12px] text-text-3">{s.enoughData ? "Measured on the candles after each signal, before spread and commission." : `Early numbers: ${s.closed} finished so far; they need more signals before they say anything. Measured on the candles after each signal, before spread and commission.`}</p>
    </div>
  );
}

export default function SignalLog({ active }: { active: boolean }) {
  const [data, setData] = useState<Mine | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/private/signals/mine", { cache: "no-store" });
      const json = await res.json();
      if (json?.status === "ok") { setData(json.data as Mine); setError(null); }
      else setError(json?.error?.message ?? "Could not load your signals.");
    } catch {
      setError("Could not load your signals.");
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [active, load]);

  return (
    <div className="rounded-lg border border-border bg-ink-3/60 p-3 text-[13px] text-text-2">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">My signals</p>
      {error && <p className="text-text-3">{error}</p>}
      {!data && !error && <p className="text-text-3">Reading your record…</p>}
      {data && (
        <>
          <SummaryLine s={data.summary} />
          {data.signals.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {data.signals.map((g) => {
                const chip = CHIP[g.status] ?? CHIP.open;
                return (
                  <li key={g.id} className="flex items-center justify-between gap-2 border-t border-border pt-2">
                    <span className="min-w-0">
                      <span className="font-medium text-text">{g.symbol}</span> <span className="text-text-3">{g.timeframe.toUpperCase()} · {g.dir} {g.entryType}</span>
                      <span className="block truncate tabular-nums text-text-3">{fmt(g.entry)} → stop {fmt(g.stop)}, target {fmt(g.target)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}>{chip.label}</span>
                      {g.resultR !== null && <span className="mt-0.5 block tabular-nums text-text-3">{g.resultR >= 0 ? "+" : ""}{g.resultR.toFixed(2)} R</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
