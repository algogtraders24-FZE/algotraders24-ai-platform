"use client";
// components/live-sync/LivePanel.tsx
// Live view of one synced account: balance/equity/floating, margin level, open
// positions, a 24 h equity line and exposure. Polls /api/private/live-sync/live
// every 30 s while mounted. Facts only: no signals, no predictions.
import { useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";
import type { LiveSummary } from "@/services/live-sync/live-summary";

type LiveData = LiveSummary & { accountId: string; currency: string; mode: string; lastSyncAt: string };

const POLL_MS = 30_000;
const money = (n: number | null | undefined, cur: string) =>
  n === null || n === undefined ? "-" : `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

function Sparkline({ points }: { points: { t: number; equity: number }[] }) {
  if (points.length < 2) return <p className="text-xs text-text-3">Equity line appears after a few minutes of syncing.</p>;
  const w = 320, h = 64, pad = 4;
  const ys = points.map((p) => p.equity);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(pad + ((p.t - t0) / (t1 - t0 || 1)) * (w - 2 * pad)).toFixed(1)},${(h - pad - ((p.equity - min) / span) * (h - 2 * pad)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" role="img" aria-label="Equity over the last 24 hours">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gold" />
    </svg>
  );
}

export default function LivePanel({ accountId }: { accountId: string }) {
  const [data, setData] = useState<LiveData | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`/api/private/live-sync/live?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" });
        const json = await r.json();
        if (!alive) return;
        if (r.ok) {
          setData(json.data as LiveData);
          setErr(false);
        } else setErr(true);
      } catch {
        if (alive) setErr(true);
      }
    }
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [accountId]);

  if (err && !data) return <p className="text-xs text-text-3">Live view is not available right now.</p>;
  if (!data) return <p className="text-xs text-text-3">Loading live view…</p>;
  if (!data.hasData || !data.latest) return <p className="text-xs text-text-3">No live snapshot yet. Make sure the EA is running on a chart.</p>;

  const l = data.latest;
  const cur = data.currency;
  const marginTone = l.marginLevelPct === null ? "neutral" : l.marginLevelPct < 150 ? "danger" : l.marginLevelPct < 300 ? "warning" : "success";

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={data.stale ? "warning" : "success"} className="normal-case">{data.stale ? "EA not reporting" : "Live"}</Badge>
        <span className="text-text-3">updated {new Date(l.time).toLocaleTimeString()}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><p className="text-xs text-text-3">Balance</p><p className="font-semibold text-text">{money(l.balance, cur)}</p></div>
        <div><p className="text-xs text-text-3">Equity</p><p className="font-semibold text-text">{money(l.equity, cur)}</p></div>
        <div><p className="text-xs text-text-3">Floating P&amp;L</p><p className={`font-semibold ${l.floating < 0 ? "text-red-400" : "text-text"}`}>{money(l.floating, cur)}</p></div>
        <div>
          <p className="text-xs text-text-3">Margin level</p>
          <p className="font-semibold text-text">{l.marginLevelPct === null ? "No open margin" : `${l.marginLevelPct.toLocaleString(undefined, { maximumFractionDigits: 0 })}%`} <Badge tone={marginTone} className="normal-case">{l.marginLevelPct === null ? "idle" : l.marginLevelPct < 150 ? "low" : l.marginLevelPct < 300 ? "watch" : "ok"}</Badge></p>
        </div>
      </div>
      <Sparkline points={data.series} />
      <p className="text-xs text-text-3">
        24 h: equity high {money(data.equityHigh, cur)} · low {money(data.equityLow, cur)} · worst drop {data.windowDrawdownPct?.toFixed(2)}% from peak
      </p>
      {l.positions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-text">Open positions ({l.positions.length}){data.withoutStopLoss > 0 ? ` · ${data.withoutStopLoss} without a stop loss` : ""}</p>
          <ul className="divide-y divide-border text-xs">
            {l.positions.map((p) => (
              <li key={p.ticket} className="flex items-center justify-between py-1.5">
                <span className="text-text">{p.symbol} {p.side} {p.volume}</span>
                <span className="text-text-3">{p.sl > 0 ? `SL ${p.sl}` : "no SL"}</span>
                <span className={p.profit < 0 ? "text-red-400" : "text-text"}>{money(p.profit, cur)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-3">Exposure: {data.exposure.map((e) => `${e.symbol} net ${e.netVolume > 0 ? "+" : ""}${e.netVolume} lots`).join(" · ")}</p>
        </div>
      )}
    </div>
  );
}
