// components/live-results/ResultsView.tsx
// Public Live Results page body (server component, no client JS). Renders ONLY what the view model
// contains: all privacy redaction already happened in services/live-results/build.ts.
import type { ReactNode } from "react";
import type { PublicResults } from "@/services/live-results/build";

const pct = (n: number | null | undefined, signed = true) => (n === null || n === undefined ? "-" : `${signed && n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const num = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? "-" : n.toFixed(d));
const money = (n: number | null | undefined, cur: string) => (n === null || n === undefined ? "-" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`);
const tone = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? "text-text" : n > 0 ? "text-emerald-400" : "text-red-400");
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const dur = (ms: number | null) => {
  if (ms === null) return "-";
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

function Panel({ title, note, children, className = "" }: { title?: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-ink-2 p-4 ${className}`}>
      {title && (
        <h2 className="mb-3 text-sm font-semibold text-text">
          {title} {note && <span className="ml-2 text-xs font-normal text-text-3">{note}</span>}
        </h2>
      )}
      {children}
    </section>
  );
}

function KV({ k, v, cls = "" }: { k: string; v: ReactNode; cls?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-dashed border-border py-1.5 last:border-0">
      <span className="text-sm text-text-2">{k}</span>
      <b className={`text-sm tabular-nums ${cls}`}>{v}</b>
    </div>
  );
}

function Pill({ children, kind = "plain" }: { children: ReactNode; kind?: "plain" | "demo" | "ok" | "warn" }) {
  const c = kind === "demo" ? "border-amber-400 text-amber-400 font-bold" : kind === "ok" ? "border-emerald-700 text-emerald-400" : kind === "warn" ? "border-amber-600 text-amber-300" : "border-border text-text-2";
  return <span className={`rounded-full border px-2.5 py-1 text-xs ${c}`}>{children}</span>;
}

function LineChart({ points, label, color = "text-gold", fill = false, syncAt }: { points: { t: number; v: number }[]; label: string; color?: string; fill?: boolean; syncAt?: number }) {
  if (points.length < 2) return <p className="text-sm text-text-3">Not enough data for a chart yet.</p>;
  const W = 640, H = 230, P = 36;
  const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
  const vs = points.map((p) => p.v);
  const lo = Math.min(0, ...vs), hi = Math.max(0.0001, ...vs) * 1.05;
  const X = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - P - 10);
  const Y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => lo + (hi - lo) * k);
  const sx = syncAt !== undefined && syncAt > t0 && syncAt <= t1 ? X(syncAt) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={P} x2={W - 10} y1={Y(v)} y2={Y(v)} className="stroke-border" strokeWidth="1" />
          <text x={P - 6} y={Y(v) + 3} textAnchor="end" className="fill-text-3" fontSize="10">{Math.round(v)}%</text>
        </g>
      ))}
      {sx !== null && (
        <>
          <rect x={P} y={P - 12} width={Math.max(0, sx - P)} height={H - 2 * P + 12} className="fill-white/[0.03]" />
          <line x1={sx} x2={sx} y1={P - 14} y2={H - P} className="stroke-amber-400" strokeDasharray="4 3" strokeWidth="1.3" />
          <text x={sx > W * 0.6 ? sx - 6 : sx + 6} y={P - 2} textAnchor={sx > W * 0.6 ? "end" : "start"} className="fill-amber-400" fontSize="10" fontWeight="600">
            Live tracking starts here ({day(syncAt as number)}) →
          </text>
          <text x={P + 6} y={P + 8} className="fill-text-3" fontSize="10">Reported by the terminal at first connect</text>
        </>
      )}
      {fill && <path d={`${path} L${X(t1)},${Y(0)} L${X(t0)},${Y(0)} Z`} className="fill-red-400/15" />}
      <path d={path} fill="none" strokeWidth="2" className={`stroke-current ${color}`} />
      <text x={P} y={H - 8} className="fill-text-3" fontSize="10">{day(t0)}</text>
      <text x={W - 10} y={H - 8} textAnchor="end" className="fill-text-3" fontSize="10">{day(t1)}</text>
    </svg>
  );
}

function drawdownSeries(growth: { t: number; growthPct: number | null }[]): { t: number; v: number }[] {
  let peak = 0;
  const out: { t: number; v: number }[] = [];
  for (const g of growth) {
    if (g.growthPct === null) continue;
    const level = 1 + g.growthPct / 100;
    if (level > peak) peak = level;
    out.push({ t: g.t, v: peak > 0 ? -((peak - level) / peak) * 100 : 0 });
  }
  return out;
}

export default function ResultsView({ r, ownerNote }: { r: PublicResults; ownerNote?: string | null }) {
  const s = r.stats, i = r.integrity;
  const cur = r.currency;
  const growth = s.growth.filter((g) => g.growthPct !== null).map((g) => ({ t: g.t, v: g.growthPct as number }));
  const dd = drawdownSeries(s.growth).map((p) => ({ t: p.t, v: p.v }));
  const maxMonth = Math.max(1, ...s.monthlyHistory.map((m) => Math.abs(m.gainPct ?? 0)));
  const preDays = i.historyStart !== null ? Math.round((i.firstSyncAt - i.historyStart) / 86_400_000) : 0;
  const lt = i.liveTracked;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      {ownerNote && <div className="rounded-lg border border-border bg-ink-2 px-3 py-2 text-xs text-text-2">{ownerNote}</div>}

      <header className="space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-text">
          {r.title} <span className="ml-2 text-xs font-medium text-text-3">Live Results</span>
        </h1>
        {r.description && <p className="text-sm text-text-2">{r.description}</p>}
        <div className="flex flex-wrap gap-2">
          <Pill kind={r.mode === "real" ? "warn" : "demo"}>{r.mode === "real" ? "REAL account" : r.mode === "contest" ? "CONTEST account" : "DEMO account"}</Pill>
          <Pill kind={i.stale ? "warn" : "ok"}>{i.stale ? `Not reporting · last update ${new Date(i.lastSyncAt).toISOString().slice(0, 16).replace("T", " ")} UTC` : "● Live · updating"}</Pill>
          <Pill>Terminal-reported (not broker-verified)</Pill>
          <Pill>Chain intact · {i.batches} batches · {i.chainHeadShort}</Pill>
          {i.filteredByMagic !== null && <Pill>Showing one EA (magic {i.filteredByMagic}) · account has {i.accountMagicCount} magic{i.accountMagicCount === 1 ? "" : "s"}</Pill>}
          <Pill>{r.marginMode}</Pill>
        </div>
      </header>

      <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-4 py-2.5 text-sm text-amber-200">
        <b>Live tracking started {day(i.firstSyncAt)}.</b>{" "}
        {preDays > 0 ? `The ${preDays} days before it (from ${day(i.historyStart as number)}) were reported by the terminal when it first connected. ` : ""}
        {lt.trades > 0
          ? `Since live tracking started: ${lt.trades} trades closed, gain ${pct(lt.gainPct)}${lt.winRatePct !== null ? `, win rate ${num(lt.winRatePct)}%` : ""}.`
          : "No trade has closed since live tracking started yet."}
        {i.gainsDiverge && " Absolute and time-weighted gain differ a lot because the capital changed: read both."}
      </div>

      <div className="grid gap-4 lg:grid-cols-[330px_1fr]">
        <Panel title="Stats">
          <KV k="Absolute gain" v={pct(s.absoluteGainPct)} cls={`text-lg ${tone(s.absoluteGainPct)}`} />
          <KV k="Time-weighted gain" v={pct(s.timeWeightedGainPct)} cls={tone(s.timeWeightedGainPct)} />
          <KV k="Daily" v={pct(s.daily.gainPct)} cls={tone(s.daily.gainPct)} />
          <KV k="Monthly" v={pct(s.monthly.gainPct)} cls={tone(s.monthly.gainPct)} />
          <KV k="Max drawdown" v={`${num(s.maxDrawdownPct)}%`} cls="text-red-400" />
          <KV k="Trades" v={s.trades} />
          <KV k="Win rate" v={`${num(s.winRatePct)}%`} />
          <KV k="Profit factor" v={num(s.profitFactor)} />
          <KV k="Payoff ratio" v={num(s.payoffRatio)} />
          <KV k="Max consecutive losses" v={s.maxConsecutiveLosses} />
          <KV k="Avg trade length" v={dur(s.avgTradeLengthMs)} />
          <KV k="Longs won" v={`${num(s.longsWonPct)}%`} />
          <KV k="Shorts won" v={`${num(s.shortsWonPct)}%`} />
          <KV k="Last update" v={`${new Date(i.lastSyncAt).toISOString().slice(0, 16).replace("T", " ")} UTC`} />
        </Panel>
        <Panel title="Growth" note="percent since the first event">
          <LineChart points={growth} label="Growth in percent since the first event" syncAt={i.firstSyncAt} />
          <h3 className="mb-1 mt-4 text-xs font-semibold text-text-2">Drawdown <span className="font-normal text-text-3">from the previous peak</span></h3>
          <LineChart points={dd} label="Drawdown in percent from the previous peak" color="text-red-400" fill />
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Periods">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-text-3"><th className="py-1.5 text-left font-medium"></th><th className="text-right font-medium">Gain</th><th className="text-right font-medium">Trades</th><th className="text-right font-medium">Win%</th></tr></thead>
            <tbody>
              {([["Today", s.daily], ["This week", s.weekly], ["This month", s.monthly], ["This year", s.yearly]] as const).map(([n, p]) => (
                <tr key={n} className="border-t border-border"><td className="py-1.5 text-text-2">{n}</td><td className={`text-right tabular-nums ${tone(p.gainPct)}`}>{pct(p.gainPct)}</td><td className="text-right tabular-nums">{p.trades}</td><td className="text-right tabular-nums">{p.winRatePct === null ? "-" : `${num(p.winRatePct)}%`}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Monthly gain">
          <div className="flex h-48 items-end gap-6 px-2">
            {s.monthlyHistory.map((m) => (
              <div key={m.month} className="flex flex-col items-center justify-end">
                <span className={`mb-1 text-xs ${tone(m.gainPct)}`}>{pct(m.gainPct)}</span>
                <div className="w-12 rounded-t-md bg-gradient-to-b from-amber-300 to-amber-700" style={{ height: `${Math.max(6, (Math.abs(m.gainPct ?? 0) / maxMonth) * 120)}px` }} />
                <span className="mt-1 text-xs text-text-2">{m.month}</span>
                <span className="text-[11px] text-text-3">{m.trades} trades</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {r.strategies.length > 0 && (
        <Panel title={`Strategies inside ${r.title}`}>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-text-3"><th className="py-1.5 text-left font-medium">Strategy</th><th className="text-left font-medium">Share of trades</th><th className="text-right font-medium">Trades</th><th className="text-right font-medium">Win%</th><th className="text-right font-medium">Profit factor</th>{r.strategies[0].net !== undefined && <th className="text-right font-medium">Net</th>}</tr></thead>
            <tbody>
              {r.strategies.map((x) => (
                <tr key={x.name} className="border-t border-border">
                  <td className="py-1.5 font-semibold text-text">{x.name}</td>
                  <td><div className="h-2 w-32 overflow-hidden rounded bg-white/10"><div className="h-full bg-gold" style={{ width: `${x.sharePct}%` }} /></div></td>
                  <td className="text-right tabular-nums">{x.trades}</td>
                  <td className="text-right tabular-nums">{num(x.winRatePct)}%</td>
                  <td className={`text-right tabular-nums ${x.profitFactor !== null && x.profitFactor < 1 ? "text-red-400" : "text-emerald-400"}`}>{num(x.profitFactor)}</td>
                  {x.net !== undefined && <td className={`text-right tabular-nums ${tone(x.net)}`}>{money(x.net, cur)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-text-3">A strategy is the part of the trade comment before _Buy / _Sell. Broker auto comments are grouped as untagged.</p>
        </Panel>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Is it skill or luck?">
          {r.edge ? (
            <>
              <p className="text-lg font-bold text-amber-400">{r.edge.level.charAt(0).toUpperCase() + r.edge.level.slice(1)} evidence of edge</p>
              <p className="mt-2 text-sm text-text-2">{r.edge.headline}</p>
              <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                <div><div className="text-xs text-text-3">Z-score (runs)</div><b>{num(s.zScore)}</b></div>
                <div><div className="text-xs text-text-3">Per-trade Sharpe</div><b>{num(s.sharpePerTrade)}</b></div>
                <div><div className="text-xs text-text-3">AHPR / GHPR</div><b>{num(s.ahprPct)}% / {num(s.ghprPct)}%</b></div>
              </div>
              <p className="mt-3 text-xs text-text-3">A level of evidence from past trades, not proof and not a validation. A large negative Z-score means wins and losses come in runs.</p>
            </>
          ) : <p className="text-sm text-text-3">Not enough closed trades yet.</p>}
        </Panel>
        <Panel title="Open positions" note={`shown with a delay, without prices${r.amounts ? "" : " or sizes"}`}>
          {r.openPositions.length === 0 ? (
            <p className="text-sm text-text-3">No open positions to show right now.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {r.openPositions.map((p, idx) => (
                <li key={idx} className="flex items-center justify-between py-1.5">
                  <span className="text-text">{p.symbol} <span className="uppercase text-text-2">{p.side}</span></span>
                  <span className="text-xs text-text-3">{p.hasStopLoss ? "has SL" : "no SL"} · {p.hasTakeProfit ? "has TP" : "no TP"}</span>
                  {p.volume !== undefined && <span className="text-xs text-text-2">{p.volume} lots</span>}
                  {p.profit !== undefined && <span className={`text-xs ${tone(p.profit)}`}>{money(p.profit, cur)}</span>}
                </li>
              ))}
            </ul>
          )}
          <h3 className="mb-1 mt-4 text-sm font-semibold text-text">By symbol</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-text-3"><th className="py-1 text-left font-medium">Symbol</th><th className="text-right font-medium">Trades</th><th className="text-right font-medium">Won</th><th className="text-right font-medium">Longs</th><th className="text-right font-medium">Shorts</th>{s.bySymbol[0]?.net !== undefined && <th className="text-right font-medium">Net</th>}</tr></thead>
            <tbody>
              {s.bySymbol.map((x) => (
                <tr key={x.symbol} className="border-t border-border"><td className="py-1.5">{x.symbol}</td><td className="text-right tabular-nums">{x.trades}</td><td className="text-right tabular-nums">{num(x.wonPct)}%</td><td className="text-right tabular-nums">{x.longs}</td><td className="text-right tabular-nums">{x.shorts}</td>{x.net !== undefined && <td className={`text-right tabular-nums ${tone(x.net)}`}>{money(x.net, cur)}</td>}</tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {r.amounts && (
        <Panel title="Money" note="shown because the page owner chose to show amounts">
          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <KV k="Balance (deposits - withdrawals + this page's profit)" v={money(r.amounts.balance, cur)} />
              <KV k="Deposits" v={money(r.amounts.deposits, cur)} />
              <KV k="Withdrawals" v={money(r.amounts.withdrawals, cur)} />
              <KV k="Profit" v={money(r.amounts.profit, cur)} cls={tone(r.amounts.profit)} />
              <KV k="Highest balance" v={money(r.amounts.highestBalance, cur)} />
            </div>
            <div>
              <KV k="Best trade" v={money(r.amounts.bestTrade, cur)} cls="text-emerald-400" />
              <KV k="Worst trade" v={money(r.amounts.worstTrade, cur)} cls="text-red-400" />
              <KV k="Average win / loss" v={`${money(r.amounts.avgWin, cur)} / ${money(r.amounts.avgLoss, cur)}`} />
              <KV k="Expectancy per trade" v={money(r.amounts.expectancy, cur)} cls={tone(r.amounts.expectancy)} />
              <KV k="Commissions / swap" v={`${money(r.amounts.commissions, cur)} / ${money(r.amounts.swap, cur)}`} />
              <KV k="Lots traded" v={num(r.amounts.lots)} />
            </div>
          </div>
        </Panel>
      )}

      <ul className="space-y-1 border-t border-border pt-4 text-xs text-text-3">
        {r.disclosure.map((d) => <li key={d}>• {d}</li>)}
      </ul>
    </div>
  );
}
