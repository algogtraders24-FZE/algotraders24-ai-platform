"use client";
// components/live-results/AccountPanels.tsx
// The interactive parts of the Live Results page (tabs, charts, history table, calendar, forecast).
// Everything here only formats data that services/live-results/build.ts already redacted: this file never sees
// a money field unless the owner chose to show amounts.
import { useMemo, useState, type ReactNode } from "react";
import type { HistoryRow } from "@/services/live-results/build";

const pct = (n: number | null | undefined, signed = true) => (n === null || n === undefined ? "-" : `${signed && n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const tone = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? "text-text" : n > 0 ? "text-emerald-400" : "text-red-400");
const money = (n: number | null | undefined, cur: string) => (n === null || n === undefined ? "-" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`);
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const stamp = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const dur = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

// ---------------------------------------------------------------- tabs
export function TabCard({ tabs, className = "" }: { tabs: { id: string; label: string; content: ReactNode }[]; className?: string }) {
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <section className={`rounded-xl border border-border bg-ink-2 ${className}`}>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border px-3 pt-3">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => setActive(t.id)} className={`rounded-t-md px-3 py-1.5 text-sm font-semibold ${active === t.id ? "bg-ink text-text" : "text-text-3 hover:text-text-2"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4">{tabs.find((t) => t.id === active)?.content}</div>
    </section>
  );
}

// ---------------------------------------------------------------- line chart with deposit / withdrawal markers
interface Pt { t: number; v: number }
interface Marker { t: number; kind: "deposit" | "withdrawal" }

function LineChart({ points, label, unit = "%", color = "text-gold", fill = false, syncAt, markers = [] }: { points: Pt[]; label: string; unit?: string; color?: string; fill?: boolean; syncAt?: number; markers?: Marker[] }) {
  if (points.length < 2) return <p className="text-sm text-text-3">Not enough data for a chart yet.</p>;
  const W = 640, H = 240, P = 44;
  const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
  const vs = points.map((p) => p.v);
  const lo = Math.min(0, ...vs), hi = Math.max(0.0001, ...vs) * 1.05;
  const X = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - P - 10);
  const Y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => lo + (hi - lo) * k);
  const sx = syncAt !== undefined && syncAt > t0 && syncAt <= t1 ? X(syncAt) : null;
  const fmt = (v: number) => (unit === "%" ? `${Math.round(v)}%` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={P} x2={W - 10} y1={Y(v)} y2={Y(v)} className="stroke-border" strokeWidth="1" />
          <text x={P - 6} y={Y(v) + 3} textAnchor="end" className="fill-text-3" fontSize="10">{fmt(v)}</text>
        </g>
      ))}
      {sx !== null && (
        <>
          <rect x={P} y={P - 12} width={Math.max(0, sx - P)} height={H - 2 * P + 12} className="fill-white/[0.03]" />
          <line x1={sx} x2={sx} y1={P - 14} y2={H - P} className="stroke-amber-400" strokeDasharray="4 3" strokeWidth="1.3" />
          <text x={sx > W * 0.6 ? sx - 6 : sx + 6} y={P - 2} textAnchor={sx > W * 0.6 ? "end" : "start"} className="fill-amber-400" fontSize="10" fontWeight="600">
            Live tracking starts here ({dayOf(syncAt as number)}) →
          </text>
          <text x={P + 6} y={P + 8} className="fill-text-3" fontSize="10">Reported by the terminal at first connect</text>
        </>
      )}
      {fill && <path d={`${path} L${X(t1)},${Y(0)} L${X(t0)},${Y(0)} Z`} className="fill-red-400/15" />}
      <path d={path} fill="none" strokeWidth="2" className={`stroke-current ${color}`} />
      {markers.map((m, i) => (
        <circle key={i} cx={X(m.t)} cy={m.kind === "deposit" ? H - P + 14 : P - 22} r="3.5" className={m.kind === "deposit" ? "fill-emerald-500" : "fill-red-500"} aria-label={`${m.kind} ${dayOf(m.t)}`} />
      ))}
      <text x={P} y={H - 8} className="fill-text-3" fontSize="10">{dayOf(t0)}</text>
      <text x={W - 10} y={H - 8} textAnchor="end" className="fill-text-3" fontSize="10">{dayOf(t1)}</text>
    </svg>
  );
}

function Legend({ items }: { items: { c: string; label: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-4 text-xs text-text-3">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5"><span className={`inline-block h-2.5 w-2.5 rounded-full ${i.c}`} />{i.label}</span>
      ))}
    </div>
  );
}

export function DayBars({ rows, label }: { rows: { date: string; gainPct: number | null }[]; label: string }) {
  if (rows.length === 0) return null;
  const W = 640, H = 90, mid = 45;
  const max = Math.max(0.5, ...rows.map((r) => Math.abs(r.gainPct ?? 0)));
  const bw = Math.max(2, Math.min(14, (W - 20) / rows.length - 1));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      <line x1={0} x2={W} y1={mid} y2={mid} className="stroke-border" />
      {rows.map((r, i) => {
        const g = r.gainPct ?? 0;
        const h = (Math.abs(g) / max) * (mid - 4);
        const x = 10 + i * ((W - 20) / rows.length);
        return (
          <rect key={r.date} x={x} y={g >= 0 ? mid - h : mid} width={bw} height={Math.max(g === 0 ? 0 : 1, h)} className={g >= 0 ? "fill-emerald-500/80" : "fill-red-500/80"} aria-label={`${r.date}: ${pct(r.gainPct)}`} />
        );
      })}
    </svg>
  );
}

function drawdownOf(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  let peak = 0;
  for (const p of pts) {
    const level = 1 + p.v / 100;
    if (level > peak) peak = level;
    out.push({ t: p.t, v: peak > 0 ? -((peak - level) / peak) * 100 : 0 });
  }
  return out;
}

export function ChartPanel({ growth, daily, syncAt, balance, cumProfit, currency }: {
  growth: { t: number; growthPct: number | null; flow?: "deposit" | "withdrawal" }[];
  daily: { date: string; gainPct: number | null }[];
  syncAt: number;
  /** Present only when the owner shows amounts. */
  balance?: number[];
  cumProfit?: number[];
  currency: string;
}) {
  const g = growth.filter((x) => x.growthPct !== null);
  const growthPts = g.map((x) => ({ t: x.t, v: x.growthPct as number }));
  const markers: Marker[] = growth.filter((x) => x.flow !== undefined).map((x) => ({ t: x.t, kind: x.flow as "deposit" | "withdrawal" }));
  const dd = drawdownOf(growthPts);
  const series = (vals: number[] | undefined): Pt[] => (vals && vals.length === growth.length ? growth.map((x, i) => ({ t: x.t, v: vals[i] })) : []);
  const tabs: { id: string; label: string; content: ReactNode }[] = [
    {
      id: "growth",
      label: "Growth",
      content: (
        <>
          <LineChart points={growthPts} label="Growth in percent since the first event" syncAt={syncAt} markers={markers} />
          <Legend items={[{ c: "bg-gold", label: "Growth (closed trades, flow-adjusted)" }, { c: "bg-emerald-500", label: "Deposit" }, { c: "bg-red-500", label: "Withdrawal" }]} />
          <h3 className="mb-1 mt-4 text-xs font-semibold text-text-2">Daily gain <span className="font-normal text-text-3">last {daily.length} days</span></h3>
          <DayBars rows={daily} label="Daily gain in percent" />
        </>
      ),
    },
  ];
  if (balance) tabs.push({ id: "balance", label: "Balance", content: <><LineChart points={series(balance)} unit={currency} label={`Balance in ${currency}`} syncAt={syncAt} markers={markers} /><Legend items={[{ c: "bg-gold", label: `Balance (${currency}, closed trades)` }, { c: "bg-emerald-500", label: "Deposit" }, { c: "bg-red-500", label: "Withdrawal" }]} /></> });
  if (cumProfit) tabs.push({ id: "profit", label: "Profit", content: <LineChart points={series(cumProfit)} unit={currency} label={`Cumulative profit in ${currency}`} syncAt={syncAt} /> });
  tabs.push({ id: "drawdown", label: "Drawdown", content: <LineChart points={dd} label="Drawdown in percent from the previous peak" color="text-red-400" fill syncAt={syncAt} /> });
  return <TabCard tabs={tabs} />;
}

// ---------------------------------------------------------------- monthly analytics (click a month -> its days)
export function MonthlyAnalytics({ months, daily, currency }: {
  months: { month: string; gainPct: number | null; trades: number; winRatePct: number | null; profit?: number }[];
  daily: { date: string; gainPct: number | null; trades: number; profit?: number }[];
  currency: string;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const max = Math.max(1, ...months.map((m) => Math.abs(m.gainPct ?? 0)));
  const picked = months.find((m) => m.month === sel) ?? null;
  const days = sel ? daily.filter((d) => d.date.startsWith(sel)) : [];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <div className="flex h-48 items-end gap-4 overflow-x-auto px-2">
          {months.map((m) => (
            <button key={m.month} onClick={() => setSel(m.month)} aria-pressed={sel === m.month} className="flex shrink-0 flex-col items-center justify-end">
              <span className={`mb-1 text-xs ${tone(m.gainPct)}`}>{pct(m.gainPct)}</span>
              <div className={`w-10 rounded-t-md ${sel === m.month ? "bg-gradient-to-b from-fuchsia-300 to-fuchsia-700" : "bg-gradient-to-b from-amber-300 to-amber-700"}`} style={{ height: `${Math.max(6, (Math.abs(m.gainPct ?? 0) / max) * 120)}px` }} />
              <span className="mt-1 text-xs text-text-2">{m.month}</span>
              <span className="text-[11px] text-text-3">{m.trades} trades</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-32 rounded-lg border border-dashed border-border p-3">
        {!picked ? (
          <p className="grid h-full place-items-center text-sm text-text-3">Select a month to see its days.</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-text">{picked.month} <span className={tone(picked.gainPct)}>{pct(picked.gainPct)}</span> <span className="font-normal text-text-3">· {picked.trades} trades{picked.winRatePct !== null ? ` · ${picked.winRatePct.toFixed(0)}% won` : ""}{picked.profit !== undefined ? ` · ${money(picked.profit, currency)}` : ""}</span></p>
            {days.length > 0 ? <DayBars rows={days} label={`Daily gain in ${picked.month}`} /> : <p className="mt-2 text-xs text-text-3">Daily detail is kept for the last 120 days only.</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- calendar
export function CalendarTab({ daily, currency }: { daily: { date: string; gainPct: number | null; trades: number; profit?: number }[]; currency: string }) {
  const monthsAvail = useMemo(() => [...new Set(daily.map((d) => d.date.slice(0, 7)))], [daily]);
  const [idx, setIdx] = useState(Math.max(0, monthsAvail.length - 1));
  if (monthsAvail.length === 0) return <p className="text-sm text-text-3">No days to show yet.</p>;
  const month = monthsAvail[Math.min(idx, monthsAvail.length - 1)];
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const cells: (null | { day: number; row?: (typeof daily)[number] })[] = [...Array(lead).fill(null)];
  for (let d = 1; d <= count; d++) cells.push({ day: d, row: byDate.get(`${month}-${String(d).padStart(2, "0")}`) });
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">‹</button>
        <b>{month}</b>
        <button onClick={() => setIdx(Math.min(monthsAvail.length - 1, idx + 1))} disabled={idx >= monthsAvail.length - 1} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-text-3">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}
        {cells.map((c, i) => c === null ? <div key={i} /> : (
          <div key={i} className={`min-h-12 rounded border border-border p-1 text-xs ${!c.row || c.row.trades === 0 ? "text-text-3" : (c.row.gainPct ?? 0) >= 0 ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
            <div className="text-[10px] text-text-3">{c.day}</div>
            {c.row && c.row.trades > 0 ? <><div className="font-semibold">{pct(c.row.gainPct)}</div><div className="text-[10px] opacity-70">{c.row.trades} tr{c.row.profit !== undefined ? ` · ${money(c.row.profit, currency)}` : ""}</div></> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- forecast (illustration, not a prediction)
export function ForecastTab({ monthlyGains, balance, currency }: { monthlyGains: number[]; balance?: number | null; currency: string }) {
  const [mode, setMode] = useState<"simple" | "compound">("compound");
  const [years, setYears] = useState(1);
  if (monthlyGains.length === 0) return <p className="text-sm text-text-3">Needs at least one month of results.</p>;
  const avg = monthlyGains.reduce((s, x) => s + x, 0) / monthlyGains.length;
  const months = years * 12;
  const pts: Pt[] = [];
  for (let k = 0; k <= months; k++) pts.push({ t: k, v: mode === "simple" ? avg * k : (Math.pow(1 + avg / 100, k) - 1) * 100 });
  const end = pts[pts.length - 1].v;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="text-text-2">Mode{" "}
          <select value={mode} onChange={(e) => setMode(e.target.value as "simple" | "compound")} className="ml-1 rounded border border-border bg-ink px-2 py-1">
            <option value="compound">Compounding</option>
            <option value="simple">Non-compounding</option>
          </select>
        </label>
        <label className="text-text-2">Years{" "}
          <select value={years} onChange={(e) => setYears(Number(e.target.value))} className="ml-1 rounded border border-border bg-ink px-2 py-1">
            {[1, 2, 3, 5, 10].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <p className="text-sm text-text-2">
        Average monthly gain so far: <b className={tone(avg)}>{pct(avg)}</b> over {monthlyGains.length} month{monthlyGains.length === 1 ? "" : "s"}. If that exact average repeated for {years} year{years === 1 ? "" : "s"}: <b className={tone(end)}>{pct(end)}</b>
        {balance ? <> (about {money(balance * (1 + end / 100), currency)} from today&apos;s {money(balance, currency)})</> : null}.
      </p>
      <svg viewBox="0 0 640 160" className="h-auto w-full" role="img" aria-label="Projection chart">
        {(() => {
          const hi = Math.max(1, ...pts.map((p) => p.v)), lo = Math.min(0, ...pts.map((p) => p.v));
          const X = (k: number) => 10 + (k / months) * 620;
          const Y = (v: number) => 140 - ((v - lo) / (hi - lo || 1)) * 120;
          return <><line x1={10} x2={630} y1={Y(0)} y2={Y(0)} className="stroke-border" /><path d={pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ")} fill="none" strokeWidth="2" strokeDasharray="5 4" className="stroke-current text-gold" /></>;
        })()}
      </svg>
      <p className="text-xs text-text-3">An illustration of arithmetic, not a prediction: past monthly results do not repeat on a schedule, and one bad month can erase many good ones.</p>
    </div>
  );
}

// ---------------------------------------------------------------- history
const PAGE = 20;

export function HistoryTable({ rows, total, amounts, currency }: { rows: HistoryRow[]; total: number; amounts: boolean; currency: string }) {
  const [page, setPage] = useState(0);
  const [asc, setAsc] = useState(false);
  const [sym, setSym] = useState("");
  const symbols = useMemo(() => [...new Set(rows.map((r) => r.symbol))].sort(), [rows]);
  const view = useMemo(() => {
    const f = sym ? rows.filter((r) => r.symbol === sym) : rows;
    return asc ? [...f].reverse() : f;
  }, [rows, sym, asc]);
  const pages = Math.max(1, Math.ceil(view.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = view.slice(cur * PAGE, cur * PAGE + PAGE);
  if (rows.length === 0) return <p className="text-sm text-text-3">No closed trades yet.</p>;
  const th = "px-2 py-1.5 text-right font-medium";
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-text-3">
        <span>Showing the latest {rows.length} of {total} closed trades{amounts ? "" : " (percent only: sizes, prices and amounts are hidden by the owner)"}</span>
        <select value={sym} onChange={(e) => { setSym(e.target.value); setPage(0); }} className="rounded border border-border bg-ink px-2 py-1 text-text-2" aria-label="Filter by symbol">
          <option value="">All symbols</option>
          {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-text-3">
              <th className="px-2 py-1.5 text-left font-medium">Open</th>
              <th className="px-2 py-1.5 text-left font-medium"><button onClick={() => setAsc(!asc)} className="font-medium hover:text-text-2">Close {asc ? "▲" : "▼"}</button></th>
              <th className="px-2 py-1.5 text-left font-medium">Symbol</th>
              <th className="px-2 py-1.5 text-left font-medium">Action</th>
              {amounts && <><th className={th}>Lots</th><th className={th}>SL</th><th className={th}>TP</th><th className={th}>Open price</th><th className={th}>Close price</th></>}
              <th className={th}>Duration</th>
              {amounts && <th className={th}>Net ({currency})</th>}
              <th className={th}>Gain</th>
              <th className="px-2 py-1.5 text-left font-medium">Strategy</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={`${r.closeTime}-${i}`} className="border-t border-border tabular-nums">
                <td className="px-2 py-1.5 text-text-2">{stamp(r.openTime)}</td>
                <td className="px-2 py-1.5 text-text-2">{stamp(r.closeTime)}</td>
                <td className="px-2 py-1.5 text-text">{r.symbol}</td>
                <td className="px-2 py-1.5 capitalize">{r.side}</td>
                {amounts && <><td className="px-2 text-right">{r.volume}</td><td className="px-2 text-right text-text-3">{r.stopLoss ?? "-"}</td><td className="px-2 text-right text-text-3">{r.takeProfit ?? "-"}</td><td className="px-2 text-right">{r.openPrice}</td><td className="px-2 text-right">{r.closePrice}</td></>}
                <td className="px-2 text-right text-text-2">{dur(r.durationMs)}</td>
                {amounts && <td className={`px-2 text-right ${tone(r.net)}`}>{r.net?.toFixed(2)}</td>}
                <td className={`px-2 text-right ${tone(r.gainPct)}`}>{pct(r.gainPct)}</td>
                <td className="px-2 text-text-3">{r.strategy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-text-3">
        <button onClick={() => setPage(Math.max(0, cur - 1))} disabled={cur === 0} className="rounded border border-border px-2 py-1 disabled:opacity-40">‹ Prev</button>
        <span>Page {cur + 1} / {pages}</span>
        <button onClick={() => setPage(Math.min(pages - 1, cur + 1))} disabled={cur >= pages - 1} className="rounded border border-border px-2 py-1 disabled:opacity-40">Next ›</button>
      </div>
    </div>
  );
}
