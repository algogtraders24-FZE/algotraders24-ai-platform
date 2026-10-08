// components/live-results/ResultsView.tsx
// Public Live Results page body (server component, no client JS). Renders ONLY what the view model
// contains: all privacy redaction already happened in services/live-results/build.ts.
import type { ReactNode } from "react";
import type { PublicResults } from "@/services/live-results/build";
import AdvancedStatsPanel from "./AdvancedStats";
import { CalendarTab, ChartPanel, ForecastTab, HistoryTable, MonthlyAnalytics, TabCard } from "./AccountPanels";

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

const TIPS: Record<string, string> = {
  "Absolute gain": "Profit divided by total deposits. A small first deposit followed by a big one cannot inflate it.",
  "Time-weighted gain": "Return per unit of capital with deposits and withdrawals removed. Compare it with the absolute gain.",
  "Max drawdown": "The largest fall from a previous balance peak, in percent.",
  "Profit factor": "Gross profit divided by gross loss. Above 1 means winners outweighed losers.",
  "Payoff ratio": "Average winning trade divided by the average losing trade.",
  "Sharpe (per trade)": "Mean result per trade divided by its standard deviation. Per trade, not annualized.",
  "Z-score (runs)": "Runs test on the win/loss sequence. A large negative number means wins and losses come in streaks.",
  "AHPR": "Average holding-period return: the mean percent gained per trade.",
  "GHPR": "Geometric holding-period return: the per-trade growth rate that compounds to the real result.",
  "Standard deviation": "How much the result of a single trade usually varies around the average.",
};

function KV({ k, v, cls = "" }: { k: string; v: ReactNode; cls?: string }) {
  const tip = TIPS[k];
  return (
    <div className="flex items-center justify-between border-b border-dashed border-border py-1.5 last:border-0">
      <span className={`text-sm text-text-2 ${tip ? "cursor-help underline decoration-dotted underline-offset-4" : ""}`} title={tip}>{k}</span>
      <b className={`text-sm tabular-nums ${cls}`}>{v}</b>
    </div>
  );
}

function Pill({ children, kind = "plain" }: { children: ReactNode; kind?: "plain" | "demo" | "ok" | "warn" }) {
  const c = kind === "demo" ? "border-amber-400 text-amber-400 font-bold" : kind === "ok" ? "border-emerald-700 text-emerald-400" : kind === "warn" ? "border-amber-600 text-amber-300" : "border-border text-text-2";
  return <span className={`rounded-full border px-2.5 py-1 text-xs ${c}`}>{children}</span>;
}

export default function ResultsView({ r, ownerNote, actions, visibility }: { r: PublicResults; ownerNote?: string | null; actions?: ReactNode; visibility?: string }) {
  const s = r.stats, i = r.integrity;
  const cur = r.currency;
  const monthlyGains = s.monthlyHistory.map((m) => m.gainPct).filter((g): g is number => g !== null);
  const tradeDate = (t: { time: number; gainPct: number | null } | null) => (t ? `${pct(t.gainPct)} (${new Date(t.time).toISOString().slice(0, 10)})` : "-");
  const preDays = i.historyStart !== null ? Math.round((i.firstSyncAt - i.historyStart) / 86_400_000) : 0;
  const lt = i.liveTracked;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 pb-8 pt-28">
      {ownerNote && <div className="rounded-lg border border-border bg-ink-2 px-3 py-2 text-xs text-text-2">{ownerNote}</div>}

      <header className="space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-text">
          {r.title} <span className="ml-2 text-xs font-medium text-text-3">Live Results</span>
        </h1>
        <p className="text-sm font-medium text-text-2">
          {r.mode === "real" ? "Real" : r.mode === "contest" ? "Contest" : "Demo"} ({cur}) · {r.marginMode} · 1:{r.account.leverage} · {r.account.platform} · {r.account.automated ? "Automated" : "Manual"}
        </p>
        {r.description && <p className="text-sm text-text-2">{r.description}</p>}
        {actions && <div>{actions}</div>}
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
        <TabCard
          tabs={[
            {
              id: "info",
              label: "Info",
              content: (
                <>
                  <KV k="Absolute gain" v={pct(s.absoluteGainPct)} cls={`text-lg ${tone(s.absoluteGainPct)}`} />
                  <KV k="Time-weighted gain" v={pct(s.timeWeightedGainPct)} cls={tone(s.timeWeightedGainPct)} />
                  <KV k="Daily" v={pct(s.daily.gainPct)} cls={tone(s.daily.gainPct)} />
                  <KV k="Monthly" v={pct(s.monthly.gainPct)} cls={tone(s.monthly.gainPct)} />
                  <KV k="Max drawdown" v={`${num(s.maxDrawdownPct)}%`} cls="text-red-400" />
                  {r.amounts && (
                    <>
                      <KV k="Balance" v={money(r.amounts.balance, cur)} />
                      <KV k="Highest balance" v={money(r.amounts.highestBalance, cur)} />
                      <KV k="Profit" v={money(r.amounts.profit, cur)} cls={tone(r.amounts.profit)} />
                      <KV k="Deposits" v={money(r.amounts.deposits, cur)} />
                      <KV k="Withdrawals" v={money(r.amounts.withdrawals, cur)} />
                    </>
                  )}
                  <KV k="Updated" v={`${new Date(i.lastSyncAt).toISOString().slice(0, 16).replace("T", " ")} UTC`} />
                </>
              ),
            },
            {
              id: "stats",
              label: "Stats",
              content: (
                <>
                  <KV k="Trades" v={s.trades} />
                  <KV k="Win rate" v={`${num(s.winRatePct)}%`} />
                  <KV k="Profit factor" v={num(s.profitFactor)} />
                  <KV k="Payoff ratio" v={num(s.payoffRatio)} />
                  <KV k="Longs won" v={`${num(s.longsWonPct)}%`} />
                  <KV k="Shorts won" v={`${num(s.shortsWonPct)}%`} />
                  <KV k="Best trade" v={tradeDate(s.bestTrade)} cls="text-emerald-400" />
                  <KV k="Worst trade" v={tradeDate(s.worstTrade)} cls="text-red-400" />
                  <KV k="Max consecutive losses" v={s.maxConsecutiveLosses} />
                  <KV k="Avg trade length" v={dur(s.avgTradeLengthMs)} />
                  <KV k="Sharpe (per trade)" v={num(s.sharpePerTrade)} />
                  <KV k="Z-score (runs)" v={`${num(s.zScore)}${s.zConfidencePct !== null ? ` (${num(s.zConfidencePct, 0)}%)` : ""}`} />
                  <KV k="AHPR" v={`${num(s.ahprPct)}%`} />
                  <KV k="GHPR" v={`${num(s.ghprPct)}%`} />
                  {r.amounts && r.amounts.stdDev !== null && <KV k="Standard deviation" v={money(r.amounts.stdDev, cur)} />}
                </>
              ),
            },
            {
              id: "general",
              label: "General",
              content: (
                <>
                  <KV k="Type" v={r.mode === "real" ? "Real" : r.mode === "contest" ? "Contest" : "Demo"} />
                  <KV k="Currency" v={cur} />
                  <KV k="Leverage" v={`1:${r.account.leverage}`} />
                  <KV k="Margin mode" v={r.marginMode} />
                  <KV k="Platform" v={r.account.platform} />
                  <KV k="Trading" v={r.account.automated ? "Automated (Expert Advisor)" : "Manual"} />
                  <KV k="Started" v={r.account.startedAt !== null ? day(r.account.startedAt) : "-"} />
                  <KV k="Live tracking since" v={day(i.firstSyncAt)} />
                  {visibility && <KV k="Status" v={visibility === "public" ? "Public" : visibility === "unlisted" ? "Unlisted (link only)" : "Private"} />}
                  <KV k="Timezone" v={`GMT${r.account.utcOffsetHours >= 0 ? "+" : ""}${r.account.utcOffsetHours}`} />
                  <KV k="Data source" v="Terminal-reported" />
                  <p className="mt-2 text-[11px] text-text-3">The broker, account number and server are never sent or shown.</p>
                </>
              ),
            },
          ]}
        />
        <ChartPanel growth={s.growth} daily={s.dailyHistory} syncAt={i.firstSyncAt} balance={r.amounts?.growthBalance} cumProfit={r.amounts?.cumProfit} currency={cur} />
      </div>

      <TabCard
        tabs={[
          {
            id: "periods",
            label: "Periods",
            content: (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-text-3"><th className="py-1.5 text-left font-medium"></th><th className="text-right font-medium">Gain</th>{r.amounts && <th className="text-right font-medium">Profit</th>}<th className="text-right font-medium">Trades</th><th className="text-right font-medium">Win%</th></tr></thead>
                <tbody>
                  {([["Today", s.daily], ["This week", s.weekly], ["This month", s.monthly], ["This year", s.yearly]] as const).map(([n, p]) => (
                    <tr key={n} className="border-t border-border"><td className="py-1.5 text-text-2">{n}</td><td className={`text-right tabular-nums ${tone(p.gainPct)}`}>{pct(p.gainPct)}</td>{r.amounts && <td className={`text-right tabular-nums ${tone(p.profit)}`}>{money(p.profit, cur)}</td>}<td className="text-right tabular-nums">{p.trades}</td><td className="text-right tabular-nums">{p.winRatePct === null ? "-" : `${num(p.winRatePct)}%`}</td></tr>
                  ))}
                </tbody>
              </table>
            ),
          },
          { id: "calendar", label: "Calendar", content: <CalendarTab daily={s.dailyHistory} currency={cur} /> },
          { id: "forecast", label: "Forecast", content: <ForecastTab monthlyGains={monthlyGains} balance={r.amounts?.balance ?? null} currency={cur} /> },
        ]}
      />

      <Panel title="Monthly analytics" note="select a month">
        <MonthlyAnalytics months={s.monthlyHistory} daily={s.dailyHistory} currency={cur} />
      </Panel>

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

      <Panel title="Trade history">
        <HistoryTable rows={r.history.rows} total={r.history.total} amounts={r.amounts !== undefined} currency={cur} />
      </Panel>

      <AdvancedStatsPanel adv={r.advanced} showAmounts={r.amounts !== undefined} currency={cur} />

      {r.amounts && (
        <Panel title="Money" note="shown because the page owner chose to show amounts">
          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <KV k="Initial deposit" v={money(r.amounts.initialDeposit, cur)} cls="text-lg" />
              <KV k="Profit" v={money(r.amounts.profit, cur)} cls={`text-lg ${tone(r.amounts.profit)}`} />
              <KV k="Balance (deposits - withdrawals + this page's profit)" v={money(r.amounts.balance, cur)} />
              <KV k="Deposits" v={money(r.amounts.deposits, cur)} />
              <KV k="Withdrawals" v={money(r.amounts.withdrawals, cur)} />
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
          {r.amounts.cashflows.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-xs font-semibold text-text-2">Deposits and withdrawals <span className="font-normal text-text-3">(broker time)</span></h3>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-text-3"><th className="py-1 text-left font-medium">Date</th><th className="text-left font-medium">Type</th><th className="text-right font-medium">Amount</th></tr></thead>
                <tbody>
                  {r.amounts.cashflows.map((c, idx) => (
                    <tr key={idx} className="border-t border-border"><td className="py-1.5 text-text-2">{day(c.time)}</td><td>{c.amount >= 0 ? (idx === 0 ? "Initial deposit" : "Deposit") : "Withdrawal"}</td><td className={`text-right tabular-nums ${c.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(c.amount, cur)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <ul className="space-y-1 border-t border-border pt-4 text-xs text-text-3">
        {r.disclosure.map((d) => <li key={d}>• {d}</li>)}
      </ul>
    </div>
  );
}
