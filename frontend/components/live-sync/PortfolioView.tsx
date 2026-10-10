"use client";
// components/live-sync/PortfolioView.tsx
// "My portfolio": every synced account of the signed-in user in one table per group (real / demo x currency) with a Total row,
// a growth-comparison chart and the period table. The user's OWN data, so amounts are shown. Refreshes every minute.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
import type { Portfolio, PortfolioGroup, PortfolioRow } from "@/services/live-sync/portfolio";

const POLL_MS = 60_000;
const COLORS = ["#d4a017", "#34d399", "#60a5fa", "#f472b6", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"];
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const tone = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? "text-text" : n > 0 ? "text-emerald-400" : "text-red-400");
const num = (n: number | null | undefined) => (n === null || n === undefined ? "-" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (t: number) => new Date(t).toISOString().slice(5, 16).replace("T", " ");

function GrowthChart({ rows }: { rows: PortfolioRow[] }) {
  const series = rows.filter((r) => r.growth.length >= 2);
  if (series.length === 0) return <p className="text-sm text-text-3">Not enough closed trades for a chart yet.</p>;
  const W = 680, H = 220, P = 40;
  const all = series.flatMap((r) => r.growth);
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  const lo = Math.min(0, ...all.map((p) => p.v)), hi = Math.max(0.0001, ...all.map((p) => p.v)) * 1.05;
  const X = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - P - 10);
  const Y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Growth of each account in percent since its first event">
        {[0, 0.5, 1].map((k) => {
          const v = lo + (hi - lo) * k;
          return (
            <g key={k}>
              <line x1={P} x2={W - 10} y1={Y(v)} y2={Y(v)} stroke="currentColor" className="text-border" />
              <text x={P - 6} y={Y(v) + 3} textAnchor="end" fontSize="10" className="fill-text-3">{Math.round(v)}%</text>
            </g>
          );
        })}
        {series.map((r, i) => (
          <path key={r.id} d={r.growth.map((p, j) => `${j ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ")} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="2" />
        ))}
        <text x={P} y={H - 8} fontSize="10" className="fill-text-3">{day(t0)}</text>
        <text x={W - 10} y={H - 8} textAnchor="end" fontSize="10" className="fill-text-3">{day(t1)}</text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
        {series.map((r, i) => <span key={r.id} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{r.label}</span>)}
      </div>
    </div>
  );
}

function GroupCard({ g, rows }: { g: PortfolioGroup; rows: PortfolioRow[] }) {
  const cur = g.currency;
  const th = "px-2 py-1.5 text-right font-medium";
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-text">{g.title}</h2>
        <Badge tone={g.mode === "real" ? "warning" : "neutral"} className="normal-case">{g.mode === "real" ? "REAL" : "DEMO"}</Badge>
        <span className="text-xs text-text-3">{g.accounts} account{g.accounts === 1 ? "" : "s"} · pooled only with accounts of the same type and currency</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {([
          ["Balance", `${num(g.balance)} ${cur}`, ""],
          ["Equity", g.equity === null ? "-" : `${num(g.equity)} ${cur}`, ""],
          ["Profit (closed)", `${num(g.profit)} ${cur}`, tone(g.profit)],
          ["Deposits", `${num(g.deposits)} ${cur}`, ""],
          ["Gain", pct(g.gainPct), tone(g.gainPct)],
          ["Max drawdown", g.maxDrawdownPct === null ? "-" : `${g.maxDrawdownPct.toFixed(2)}%`, "text-red-400"],
        ] as const).map(([k, v, c]) => (
          <div key={k}>
            <p className="text-[11px] uppercase tracking-wide text-text-3">{k}</p>
            <p className={`text-sm font-semibold tabular-nums ${c}`}>{v}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm [&_td]:whitespace-nowrap [&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-0 [&_th:first-child]:pl-0">
          <thead>
            <tr className="text-xs text-text-3">
              <th className="py-1.5 text-left font-medium">Account</th>
              <th className={th}>Gain</th><th className={th}>Abs. gain</th><th className={th}>Today</th><th className={th}>Month</th><th className={th}>Drawdown</th>
              <th className={th}>Balance</th><th className={th}>Equity</th><th className={th}>Profit</th><th className={th}>Deposits</th><th className={th}>Trades</th><th className={th}>Win %</th><th className={th}>Updated (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border tabular-nums">
                <td className="py-1.5">
                  <Link href="/dashboard/live-sync" className="font-semibold text-text hover:text-gold">{r.label}</Link>
                  <span className="ml-2 text-[11px] text-text-3">{r.platform}{r.broker ? ` · ${r.broker}` : ""}</span>
                  {r.stale && <Badge tone="warning" className="ml-2 normal-case">not reporting</Badge>}
                </td>
                <td className={`text-right ${tone(r.gainPct)}`}>{pct(r.gainPct)}</td>
                <td className={`text-right ${tone(r.absoluteGainPct)}`}>{pct(r.absoluteGainPct)}</td>
                <td className={`text-right ${tone(r.dailyPct)}`}>{pct(r.dailyPct)}</td>
                <td className={`text-right ${tone(r.monthlyPct)}`}>{pct(r.monthlyPct)}</td>
                <td className="text-right text-red-400">{r.maxDrawdownPct === null ? "-" : `${r.maxDrawdownPct.toFixed(2)}%`}</td>
                <td className="text-right">{num(r.balance)}</td>
                <td className="text-right">{num(r.equity)}</td>
                <td className={`text-right ${tone(r.profit)}`}>{num(r.profit)}</td>
                <td className="text-right">{num(r.deposits)}</td>
                <td className="text-right">{r.trades}</td>
                <td className="text-right">{r.winRatePct === null ? "-" : `${r.winRatePct.toFixed(1)}%`}</td>
                <td className="text-right text-text-3">{utc(r.lastSyncAt)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-semibold tabular-nums">
              <td className="py-1.5">Total ({cur})</td>
              <td className={`text-right ${tone(g.gainPct)}`}>{pct(g.gainPct)}</td>
              <td className={`text-right ${tone(g.absoluteGainPct)}`}>{pct(g.absoluteGainPct)}</td>
              <td className={`text-right ${tone(g.periods.today.gainPct)}`}>{pct(g.periods.today.gainPct)}</td>
              <td className={`text-right ${tone(g.periods.month.gainPct)}`}>{pct(g.periods.month.gainPct)}</td>
              <td className="text-right text-red-400">{g.maxDrawdownPct === null ? "-" : `${g.maxDrawdownPct.toFixed(2)}%`}</td>
              <td className="text-right">{num(g.balance)}</td>
              <td className="text-right">{num(g.equity)}</td>
              <td className={`text-right ${tone(g.profit)}`}>{num(g.profit)}</td>
              <td className="text-right">{num(g.deposits)}</td>
              <td className="text-right">{g.trades}</td>
              <td className="text-right">{g.winRatePct === null ? "-" : `${g.winRatePct.toFixed(1)}%`}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-text-3 md:hidden">Swipe the table sideways to see every column.</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-text">Growth of each account <span className="font-normal text-text-3">percent since its first event</span></h3>
          <GrowthChart rows={rows} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-text">Periods <span className="font-normal text-text-3">all accounts in this group together</span></h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm [&_td]:whitespace-nowrap [&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-0 [&_th:first-child]:pl-0">
              <thead><tr className="text-xs text-text-3"><th className="py-1.5 text-left font-medium"></th><th className={th}>Gain</th><th className={th}>Profit</th><th className={th}>Trades</th><th className={th}>Win %</th></tr></thead>
              <tbody>
                {([["Today", g.periods.today], ["This week", g.periods.week], ["This month", g.periods.month], ["This year", g.periods.year]] as const).map(([name, p]) => (
                  <tr key={name} className="border-t border-border tabular-nums">
                    <td className="py-1.5 text-text-2">{name}</td>
                    <td className={`text-right ${tone(p.gainPct)}`}>{pct(p.gainPct)}</td>
                    <td className={`text-right ${tone(p.profit)}`}>{num(p.profit)}</td>
                    <td className="text-right">{p.trades}</td>
                    <td className="text-right">{p.winRatePct === null ? "-" : `${p.winRatePct.toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function PortfolioView() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/private/live-sync/portfolio", { cache: "no-store" });
      if (!r.ok) {
        setError(r.status === 503 ? "Live Sync is not available yet." : "Could not load your portfolio.");
        return;
      }
      setData((await r.json()).data as Portfolio);
      setError(null);
    } catch {
      setError("Could not load your portfolio.");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      {!error && data === null && <p className="text-sm text-text-3">Loading…</p>}
      {data && data.rows.length === 0 && (
        <Card className="space-y-2">
          <p className="text-sm font-semibold text-text">No synced accounts yet</p>
          <p className="text-sm text-text-2">Connect a MetaTrader 4 or 5 terminal on the <Link href="/dashboard/live-sync" className="text-gold hover:underline">Live Sync</Link> page and your accounts will appear here.</p>
        </Card>
      )}
      {data?.groups.map((g) => <GroupCard key={g.key} g={g} rows={data.rows.filter((r) => `${r.mode === "real" ? "real" : "demo"}|${r.currency}` === g.key)} />)}
      {data && data.rows.length > 0 && (
        <p className="text-xs text-text-3">
          Closed trades only; balance and equity are your terminal&apos;s own figures at its last sync. Real and demo accounts are never pooled together and currencies are never added: each group above is its own total. Everything is reported by your own MetaTrader terminals and is not independently verified. Past results do not predict future results.
        </p>
      )}
    </div>
  );
}
