"use client";
// components/live-results/DirectoryExplorer.tsx
// The "Public pages" list of Live Results: search + filters, sort by FACTS about the track record (never by gain),
// a sparkline per page, and a side-by-side Compare of up to four pages. Percent only: it reads ResultsSummary,
// which never carries money. Every card says whether the record is long enough to judge.
import { useMemo, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import ButtonLink from "@/components/ui/ButtonLink";
import FollowButton from "./FollowButton";
import { DEFAULT_FILTER, DIRECTORY_SORTS, MAX_COMPARE, MIN_TRADES_TO_JUDGE, compareRows, filterAndSort, type DirectoryFilter, type DirectorySort, type ResultsSummary } from "@/services/live-results/summary";

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const tone = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? "text-text" : n > 0 ? "text-emerald-400" : "text-red-400");
const utc = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const COLORS = ["#d4a017", "#34d399", "#60a5fa", "#f472b6"];

function Sparkline({ values, color = "#d4a017", w = 150, h = 40 }: { values: number[]; color?: string; w?: number; h?: number }) {
  if (values.length < 2) return <div className="grid h-10 w-[150px] place-items-center text-[10px] text-text-3">not enough data</div>;
  const lo = Math.min(0, ...values), hi = Math.max(0.0001, ...values);
  const X = (i: number) => (i / (values.length - 1)) * (w - 2) + 1;
  const Y = (v: number) => h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Growth in percent since the first event">
      <line x1="0" x2={w} y1={Y(0)} y2={Y(0)} stroke="currentColor" className="text-border" strokeWidth="1" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

function Stat({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-text-3">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

function CompareChart({ items }: { items: ResultsSummary[] }) {
  const W = 640, H = 200, P = 36;
  const all = items.flatMap((p) => p.sparkline);
  if (all.length < 2) return null;
  const lo = Math.min(0, ...all), hi = Math.max(0.0001, ...all) * 1.05;
  const Y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Growth of the compared pages in percent since each page's first event">
      {[0, 0.5, 1].map((k) => {
        const v = lo + (hi - lo) * k;
        return (
          <g key={k}>
            <line x1={P} x2={W - 8} y1={Y(v)} y2={Y(v)} stroke="currentColor" className="text-border" />
            <text x={P - 6} y={Y(v) + 3} textAnchor="end" fontSize="10" className="fill-text-3">{Math.round(v)}%</text>
          </g>
        );
      })}
      {items.map((p, idx) => p.sparkline.length > 1 && (
        <path key={p.slug} d={p.sparkline.map((v, i) => `${i ? "L" : "M"}${(P + (i / (p.sparkline.length - 1)) * (W - P - 8)).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")} fill="none" stroke={COLORS[idx % COLORS.length]} strokeWidth="2" />
      ))}
      <text x={P} y={H - 8} fontSize="10" className="fill-text-3">each page from its own first event (different lengths, not the same dates)</text>
    </svg>
  );
}

export default function DirectoryExplorer({ items, following, onFollowChange }: { items: ResultsSummary[]; following: string[]; onFollowChange?: () => void }) {
  const [filter, setFilter] = useState<DirectoryFilter>(DEFAULT_FILTER);
  const [sort, setSort] = useState<DirectorySort>("newest");
  const [picked, setPicked] = useState<string[]>([]);
  const view = useMemo(() => filterAndSort(items, filter, sort), [items, filter, sort]);
  const compared = picked.map((s) => items.find((p) => p.slug === s)).filter((p): p is ResultsSummary => p !== undefined);
  const toggle = (slug: string) => setPicked((c) => (c.includes(slug) ? c.filter((s) => s !== slug) : c.length >= MAX_COMPARE ? c : [...c, slug]));
  const field = "rounded-md border border-border bg-ink-2 px-2 py-1.5 text-sm text-text";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${field} min-w-[180px] flex-1`} placeholder="Search by name, description or broker" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} aria-label="Search" />
        <select className={field} value={filter.mode} onChange={(e) => setFilter({ ...filter, mode: e.target.value as DirectoryFilter["mode"] })} aria-label="Account type">
          <option value="all">Demo and real</option><option value="demo">Demo only</option><option value="real">Real only</option>
        </select>
        <select className={field} value={filter.platform} onChange={(e) => setFilter({ ...filter, platform: e.target.value as DirectoryFilter["platform"] })} aria-label="Platform">
          <option value="all">MT4 and MT5</option><option value="mt5">MT5</option><option value="mt4">MT4</option>
        </select>
        <select className={field} value={sort} onChange={(e) => setSort(e.target.value as DirectorySort)} aria-label="Sort">
          {DIRECTORY_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-text-2"><input type="checkbox" checked={filter.liveOnly} onChange={(e) => setFilter({ ...filter, liveOnly: e.target.checked })} />Reporting now</label>
        <label className="flex items-center gap-1.5 text-xs text-text-2"><input type="checkbox" checked={filter.enoughOnly} onChange={(e) => setFilter({ ...filter, enoughOnly: e.target.checked })} />At least {MIN_TRADES_TO_JUDGE} trades</label>
      </div>
      <p className="text-xs text-text-3">There is no sort by gain on purpose: ranking by gain rewards risk-taking and cherry-picking. Look at the drawdown, the number of trades and the live-forward record next to the gain. Tick up to {MAX_COMPARE} pages to compare them side by side.</p>

      {compared.length >= 2 && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-text">Comparing {compared.length} pages</p>
            <button className="text-xs font-semibold text-gold hover:underline" onClick={() => setPicked([])}>Clear</button>
          </div>
          <CompareChart items={compared} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-text-3">
                  <th className="py-1.5 text-left font-medium"></th>
                  {compared.map((p, i) => <th key={p.slug} className="px-2 text-right font-semibold" style={{ color: COLORS[i % COLORS.length] }}>{p.title}</th>)}
                </tr>
              </thead>
              <tbody>
                {compareRows(compared).map((r) => (
                  <tr key={r.label} className="border-t border-border">
                    <td className="py-1.5 text-text-2">{r.label}</td>
                    {r.cells.map((c, i) => <td key={i} className="px-2 text-right tabular-nums text-text">{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {view.length === 0 && <Card><p className="text-sm text-text-2">No page matches these filters.</p></Card>}
      <div className="grid gap-4 md:grid-cols-2">
        {view.map((p) => (
          <Card key={p.slug} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-bold text-text">{p.title}</p>
              <Badge tone={p.mode === "real" ? "warning" : "neutral"} className="normal-case">{p.mode === "real" ? "REAL" : p.mode === "contest" ? "CONTEST" : "DEMO"}</Badge>
              <Badge tone="neutral" className="normal-case">{p.platform === "mt4" ? "MT4" : "MT5"}</Badge>
              {p.oneEa && <Badge tone="neutral" className="normal-case">one EA</Badge>}
              <Badge tone={p.stale ? "warning" : "success"} className="normal-case">{p.stale ? "not reporting" : "live"}</Badge>
              {!p.enoughData && <Badge tone="warning" className="normal-case">too few trades to judge</Badge>}
            </div>
            {p.description && <p className="text-sm text-text-2">{p.description}</p>}
            <div className="flex items-center gap-4">
              <Sparkline values={p.sparkline} />
              <div className="grid flex-1 grid-cols-3 gap-x-3 gap-y-2">
                <Stat label="Gain" value={pct(p.gainPct)} cls={tone(p.gainPct)} />
                <Stat label="Max drawdown" value={p.maxDrawdownPct === null ? "-" : `${p.maxDrawdownPct.toFixed(2)}%`} cls="text-red-400" />
                <Stat label="Trades" value={String(p.trades)} />
                <Stat label="This month" value={pct(p.monthlyPct)} cls={tone(p.monthlyPct)} />
                <Stat label="This year" value={pct(p.yearlyPct)} cls={tone(p.yearlyPct)} />
                <Stat label="Avg month" value={pct(p.avgMonthlyPct)} cls={tone(p.avgMonthlyPct)} />
              </div>
            </div>
            <p className="text-xs text-text-3">
              Live forward: {p.liveForward.trades > 0 ? `${pct(p.liveForward.gainPct)} over ${p.liveForward.trades} trades` : "no trade closed since the first sync yet"} · tracked {p.daysSinceFirstSync} day{p.daysSinceFirstSync === 1 ? "" : "s"} · last update {utc(p.lastSyncAt)}
              {p.broker ? ` · ${p.broker} (self-reported)` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink size="sm" href={`/results/${p.slug}`}>Open results</ButtonLink>
              <FollowButton slug={p.slug} signedIn initialFollowing={following.includes(p.slug)} size="sm" onChange={onFollowChange} />
              <label className="flex items-center gap-1.5 text-xs text-text-2">
                <input type="checkbox" checked={picked.includes(p.slug)} disabled={!picked.includes(p.slug) && picked.length >= MAX_COMPARE} onChange={() => toggle(p.slug)} />
                Compare
              </label>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-text-3">
        Terminal-reported, not independently verified. Percentages only. <Link href="/api/public/live-results" className="text-gold hover:underline">Public JSON</Link> of this list is available for developers.
      </p>
    </div>
  );
}
