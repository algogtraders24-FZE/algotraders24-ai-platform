"use client";
// app/dashboard/admin/signals/page.tsx
// Admin scoreboard of every Pro Chart signal the platform generated and what became of it (measured on later candles, before spread and
// commission). The record that tells us whether the signal rule is doing what it should; nothing here is a forecast.
import { useEffect, useState } from "react";
import { SummaryLine } from "@/components/chart-engine/SignalLog";
import type { SignalSummary } from "@/lib/chart-engine/signals/stats";

interface SignalView { id: string; symbol: string; timeframe: string; dir: string; entryType: string; entry: number; stop: number; target: number; rr: number; score: number; scoreMax: number; status: string; resultR: number | null; createdAt: string }
interface Platform { summary: SignalSummary; bySymbol: { symbol: string; summary: SignalSummary }[]; recent: SignalView[]; users: number }

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);

export default function AdminSignalsPage() {
  const [data, setData] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/private/admin/signals", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (cancelled) return; if (j?.status === "ok") setData(j.data as Platform); else setError(j?.error?.message ?? "Could not load the signal record."); })
      .catch(() => { if (!cancelled) setError("Could not load the signal record."); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-text">Signal record</h2>
        <p className="mt-1 text-sm text-text-2">Every trade plan the Pro Chart generated, followed on the candles that came after it. Measured before spread and commission.</p>
      </div>
      {error && <p className="text-sm text-text-3">{error}</p>}
      {!data && !error && <p className="text-sm text-text-3">Reading the record and following open signals…</p>}
      {data && (
        <>
          <div className="rounded-panel border border-border bg-ink-2 p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-3">All users ({data.users} with at least one signal)</p>
            <SummaryLine s={data.summary} />
          </div>

          <div className="overflow-x-auto rounded-panel border border-border bg-ink-2">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-3">
                <tr><th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Signals</th><th className="px-3 py-2">Finished</th><th className="px-3 py-2">Target</th><th className="px-3 py-2">Stop</th><th className="px-3 py-2">Target first</th><th className="px-3 py-2">Break-even</th><th className="px-3 py-2">Avg R</th></tr>
              </thead>
              <tbody>
                {data.bySymbol.map(({ symbol, summary: s }) => (
                  <tr key={symbol} className="border-t border-border text-text-2">
                    <td className="px-3 py-2 font-medium text-text">{symbol}</td>
                    <td className="px-3 py-2 tabular-nums">{s.total}</td>
                    <td className="px-3 py-2 tabular-nums">{s.closed}</td>
                    <td className="px-3 py-2 tabular-nums text-green-400">{s.target}</td>
                    <td className="px-3 py-2 tabular-nums text-red-400">{s.stop}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(s.targetShare)}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(s.breakEvenShare)}</td>
                    <td className="px-3 py-2 tabular-nums">{s.avgR === null ? "n/a" : `${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}`}</td>
                  </tr>
                ))}
                {data.bySymbol.length === 0 && <tr><td className="px-3 py-3 text-text-3" colSpan={8}>No signals recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-panel border border-border bg-ink-2">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-3">
                <tr><th className="px-3 py-2">When (UTC)</th><th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">R</th></tr>
              </thead>
              <tbody>
                {data.recent.map((g) => (
                  <tr key={g.id} className="border-t border-border text-text-2">
                    <td className="px-3 py-2 tabular-nums">{g.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-3 py-2 text-text">{g.symbol} {g.timeframe.toUpperCase()}</td>
                    <td className="px-3 py-2 tabular-nums">{g.dir} {g.entryType} {g.entry} / {g.stop} / {g.target}</td>
                    <td className="px-3 py-2 tabular-nums">{g.score}/{g.scoreMax}</td>
                    <td className="px-3 py-2">{g.status}</td>
                    <td className="px-3 py-2 tabular-nums">{g.resultR === null ? "" : `${g.resultR >= 0 ? "+" : ""}${g.resultR.toFixed(2)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
