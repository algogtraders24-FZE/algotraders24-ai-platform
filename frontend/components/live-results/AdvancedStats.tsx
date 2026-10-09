"use client";
// components/live-results/AdvancedStats.tsx
// "Advanced statistics" tabs for a Live Results page: Hourly, Daily, Risk of ruin, Duration.
// Receives the already-redacted view model (counts, percentages, probabilities; money only if the owner opted in).
import { useState } from "react";
import type { AdvancedStats } from "@/services/live-results/advanced";

type Tab = "hourly" | "daily" | "ruin" | "duration";

const TABS: { id: Tab; label: string }[] = [
  { id: "hourly", label: "Hourly" },
  { id: "daily", label: "Daily" },
  { id: "ruin", label: "Risk of ruin" },
  { id: "duration", label: "Duration" },
];

const pct = (p: number) => (p > 0 && p < 0.001 ? "<0.1%" : `${(p * 100).toFixed(1)}%`);
const fmtDur = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${(m / 1440).toFixed(1)}d`;
};

function HourlyChart({ hourly }: { hourly: AdvancedStats["hourly"] }) {
  const W = 640, H = 220, P = 30;
  const max = Math.max(1, ...hourly.map((h) => h.wins + h.losses));
  const bw = (W - P - 10) / 24;
  const Y = (v: number) => H - P - (v / max) * (H - P - 14);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Winning and losing trades by hour of entry">
      {[0, 0.5, 1].map((k) => (
        <g key={k}>
          <line x1={P} x2={W - 10} y1={Y(max * k)} y2={Y(max * k)} className="stroke-border" />
          <text x={P - 4} y={Y(max * k) + 3} textAnchor="end" fontSize="9" className="fill-text-3">{Math.round(max * k)}</text>
        </g>
      ))}
      {hourly.map((h) => {
        const x = P + h.hour * bw + 2;
        const total = h.wins + h.losses;
        return (
          <g key={h.hour}>
            <rect x={x} y={Y(h.wins)} width={bw - 4} height={H - P - Y(h.wins)} className="fill-emerald-500/80" />
            <rect x={x} y={Y(total)} width={bw - 4} height={Y(h.wins) - Y(total)} className="fill-red-400/70" />
            {total > 0 && <text x={x + (bw - 4) / 2} y={Y(total) - 3} textAnchor="middle" fontSize="8" className="fill-text-2">{total}</text>}
            <text x={x + (bw - 4) / 2} y={H - P + 11} textAnchor="middle" fontSize="8" className="fill-text-3">{h.hour}</text>
          </g>
        );
      })}
      <text x={W - 10} y={H - 4} textAnchor="end" fontSize="9" className="fill-text-3">hour of entry (broker time)</text>
    </svg>
  );
}

function DurationChart({ points }: { points: AdvancedStats["duration"] }) {
  if (points.length < 2) return <p className="text-sm text-text-3">Not enough closed trades yet.</p>;
  const W = 640, H = 240, P = 38;
  const mins = points.map((p) => Math.max(1, p.durationMs / 60000));
  const lx = (m: number) => Math.log10(m);
  const xMin = lx(Math.min(...mins)), xMax = Math.max(xMin + 0.5, lx(Math.max(...mins)));
  const ys = points.map((p) => p.gainPct);
  const yAbs = Math.max(0.5, ...ys.map((y) => Math.abs(y)));
  const X = (m: number) => P + ((lx(m) - xMin) / (xMax - xMin)) * (W - P - 14);
  const Y = (v: number) => H / 2 - (v / yAbs) * (H / 2 - 24);
  const ticks = [1, 10, 60, 240, 1440, 10080].filter((m) => lx(m) >= xMin - 0.01 && lx(m) <= xMax + 0.01);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Growth percent of each trade against how long it was held">
      <line x1={P} x2={W - 10} y1={Y(0)} y2={Y(0)} className="stroke-border" />
      {[-yAbs, yAbs].map((v) => (<text key={v} x={P - 4} y={Y(v) + 3} textAnchor="end" fontSize="9" className="fill-text-3">{v > 0 ? "+" : ""}{v.toFixed(1)}%</text>))}
      <text x={P - 4} y={Y(0) + 3} textAnchor="end" fontSize="9" className="fill-text-3">0%</text>
      {ticks.map((m) => (<text key={m} x={X(m)} y={H - 8} textAnchor="middle" fontSize="9" className="fill-text-3">{fmtDur(m * 60000)}</text>))}
      {points.map((p, i) => (
        <circle key={i} cx={X(Math.max(1, p.durationMs / 60000))} cy={Y(p.gainPct)} r="3" className={p.win ? "fill-emerald-400/70" : "fill-red-400/70"} />
      ))}
    </svg>
  );
}

export default function AdvancedStatsPanel({ adv, showAmounts, currency }: { adv: AdvancedStats; showAmounts: boolean; currency: string }) {
  const [tab, setTab] = useState<Tab>("hourly");
  return (
    <section className="rounded-xl border border-border bg-ink-2 p-4">
      <h2 className="mb-3 text-sm font-semibold text-text">Advanced statistics</h2>
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`rounded-md px-3 py-1 text-xs font-medium ${tab === t.id ? "bg-gold text-ink" : "bg-white/5 text-text-2 hover:text-text"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "hourly" && (
        <>
          <HourlyChart hourly={adv.hourly} />
          <p className="mt-2 text-xs text-text-3"><span className="text-emerald-400">■</span> winners <span className="ml-2 text-red-400">■</span> losers, counted by the hour each trade was opened (broker server time).</p>
        </>
      )}

      {tab === "daily" && (
        <>
          <div className="overflow-x-auto"><table className="w-full min-w-max text-sm [&_td]:whitespace-nowrap [&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-0 [&_th:first-child]:pl-0">
            <thead><tr className="text-xs text-text-3"><th className="py-1.5 text-left font-medium">Day of entry</th><th className="text-right font-medium">Trades</th><th className="text-right font-medium">Win%</th>{showAmounts && <th className="text-right font-medium">Net</th>}<th className="w-40 text-left font-medium pl-4">Win rate</th></tr></thead>
            <tbody>
              {adv.weekday.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="py-1.5 text-text-2">{d.day}</td>
                  <td className="text-right tabular-nums">{d.trades}</td>
                  <td className="text-right tabular-nums">{d.winRatePct === null ? "-" : `${d.winRatePct.toFixed(1)}%`}</td>
                  {showAmounts && <td className={`text-right tabular-nums ${(d.net ?? 0) < 0 ? "text-red-400" : "text-emerald-400"}`}>{d.net === undefined ? "-" : `${d.net.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${currency}`}</td>}
                  <td className="pl-4"><div className="h-2 w-32 overflow-hidden rounded bg-white/10"><div className="h-full bg-gold" style={{ width: `${d.winRatePct ?? 0}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="mt-2 text-xs text-text-3">By the weekday each trade was opened (broker server time).</p>
        </>
      )}

      {tab === "ruin" && (adv.ruin ? (
        <>
          <div className="overflow-x-auto"><table className="w-full min-w-max text-sm [&_td]:whitespace-nowrap [&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-0 [&_th:first-child]:pl-0">
            <thead><tr className="text-xs text-text-3"><th className="py-1.5 text-left font-medium">Loss size</th><th className="text-right font-medium">Chance, trades independent</th><th className="text-right font-medium">Chance, streaks kept</th><th className="text-right font-medium">Average losses in a row</th></tr></thead>
            <tbody>
              {adv.ruin.rows.map((r) => (
                <tr key={r.lossPct} className="border-t border-border">
                  <td className="py-1.5 text-text-2">{r.lossPct}% of the account</td>
                  <td className="text-right tabular-nums">{pct(r.probIndependent)}</td>
                  <td className={`text-right tabular-nums ${r.probStreak >= 0.25 ? "text-red-400" : ""}`}>{pct(r.probStreak)}</td>
                  <td className="text-right tabular-nums">{r.consecutiveAvgLosses ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="mt-2 text-xs text-text-3">
            Chance that the account falls this far from a peak at some point in the next {adv.ruin.horizonTrades} trades, from a seeded resampling of this page&apos;s own results. &quot;Streaks kept&quot; is the more cautious reading.
            &quot;Average losses in a row&quot; is how many average-sized losing trades back to back it would take to lose that share of the current balance; the longest losing streak so far is {adv.ruin.longestLosingStreak}.
            An illustration of risk, not a forecast.
          </p>
        </>
      ) : <p className="text-sm text-text-3">At least 30 closed trades and a known deposit are needed for the risk table.</p>)}

      {tab === "duration" && (
        <>
          <DurationChart points={adv.duration} />
          <p className="mt-2 text-xs text-text-3"><span className="text-emerald-400">●</span> winners <span className="ml-2 text-red-400">●</span> losers. Each dot is one of the last {adv.duration.length} closed trades: its growth as a percent of the balance before it (up/down) against how long it was held (log scale, left = minutes, right = days).</p>
        </>
      )}
    </section>
  );
}
