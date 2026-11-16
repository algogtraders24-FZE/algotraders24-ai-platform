// app/dashboard/swing-lab/page.tsx
// Swing Lab - process tools for swing trading forex pairs, metals, energy and stock indices (crypto has its own page, Crypto Flow):
// a weekly / daily / 4-hour trend and key-level map, and a position planner that turns a risk limit and a stop into a size.
// Descriptive, not a signal: our own tests found no edge in the popular daily swing rules, so nothing here says "buy" or "sell".
// Data: the AT24 MT5 data bridge (Exness symbols), read-only.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";
import { SWING_GROUP_TITLE, SWING_INSTRUMENTS, getSwingInstrument, type SwingGroup, type SwingLevel, type SwingMapOverview, type SwingMapRow, type SwingQuote, type SwingTrend } from "@/types/swing-lab";
import { planSwing, type PlanSide } from "@/services/swing-lab/planner";
import type { SwingScoreboard, SwingScoreRowDto } from "@/types/swing-lab";

type LoadState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

const REFRESH_MS = 5 * 60_000;
const GROUPS: SwingGroup[] = ["forex", "metals", "energy", "indices"];

function fmtPrice(v: number): string {
  const digits = v >= 1000 ? 2 : v >= 100 ? 3 : v >= 10 ? 4 : 5;
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const TREND_TONE: Record<SwingTrend, string> = {
  up: "border-success/40 bg-success/10 text-success",
  down: "border-danger/40 bg-danger/10 text-danger",
  mixed: "border-border bg-surface-2 text-text-2",
};

function TrendChip({ label, trend }: { label: string; trend: SwingTrend | null }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${trend ? TREND_TONE[trend] : "border-border text-text-3"}`} title={`${label} trend: ${trend ?? "not enough history"}`}>
      {label} {trend ?? "-"}
    </span>
  );
}

function LevelCell({ level, side }: { level: SwingLevel | null; side: "support" | "resistance" }) {
  if (!level) return <span className="text-text-3">-</span>;
  return (
    <div title={level.source}>
      <div className={side === "support" ? "text-success" : "text-danger"}>{fmtPrice(level.price)}</div>
      <div className="text-xs text-text-3">
        {level.distancePct >= 0 ? "+" : ""}
        {level.distancePct.toFixed(2)}% &middot; {Math.abs(level.distanceAtr).toFixed(2)} ATR
      </div>
    </div>
  );
}

function RangeBar({ pct }: { pct: number }) {
  return (
    <div className="w-24" title={`${pct.toFixed(0)}% of the last 50 days' range`}>
      <div className="relative h-2 rounded-full bg-surface-2">
        <div className="absolute top-1/2 h-3 w-1.5 -translate-y-1/2 rounded bg-gold" style={{ left: `calc(${Math.min(100, Math.max(0, pct))}% - 3px)` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-text-3">
        <span>low</span>
        <span>{pct < 0 ? "below range" : pct > 100 ? "above range" : `${pct.toFixed(0)}%`}</span>
        <span>high</span>
      </div>
    </div>
  );
}

const ALIGN_TONE: Record<SwingMapRow["alignment"], string> = { "aligned up": "text-success", "aligned down": "text-danger", mixed: "text-text-2" };

/** The market is shut when its last closed 4-hour bar is older than 8 hours (weekend, holiday). */
function isClosed(asOfBar: number): boolean {
  return Date.now() - asOfBar > 8 * 3_600_000;
}

function num(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function Field({ label, value, onChange, suffix, hint }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; hint?: string }) {
  return (
    <label className="block text-xs text-text-2">
      {label}
      <div className="mt-1 flex items-center rounded-lg border border-border bg-surface-2 px-2">
        <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className="w-full bg-transparent py-2 text-sm text-text-1 outline-none" />
        {suffix ? <span className="pl-1 text-xs text-text-3">{suffix}</span> : null}
      </div>
      {hint ? <span className="text-[11px] text-text-3">{hint}</span> : null}
    </label>
  );
}

/** USD value of one unit of the quote currency, from the map's own prices (null when the needed pair is not loaded). */
function quoteRate(quote: SwingQuote, price: (symbol: string) => number | null): number | null {
  switch (quote) {
    case "USD":
      return 1;
    case "none":
      return null;
    case "EUR":
      return price("EURUSD");
    case "GBP":
      return price("GBPUSD");
    case "JPY": {
      const p = price("USDJPY");
      return p ? 1 / p : null;
    }
    case "CAD": {
      const p = price("USDCAD");
      return p ? 1 / p : null;
    }
    case "CHF": {
      const p = price("USDCHF");
      return p ? 1 / p : null;
    }
  }
}

interface Prefill {
  symbol: string;
  entry: number;
  stop: number | null;
  target: number | null;
  side: PlanSide;
  rate: number | null;
}

/** Position planner: a risk limit and a stop become a size. Pure arithmetic in the browser, nothing is saved or sent. */
function Planner({ row, prefill }: { row: SwingMapRow | null; prefill: Prefill | null }) {
  const [account, setAccount] = useState("10000");
  const [riskPct, setRiskPct] = useState("1");
  const [side, setSide] = useState<PlanSide>("long");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [rate, setRate] = useState("1");

  useEffect(() => {
    if (!prefill) return;
    setSide(prefill.side);
    setEntry(String(prefill.entry));
    setStop(prefill.stop === null ? "" : String(prefill.stop));
    setTarget(prefill.target === null ? "" : String(prefill.target));
    setRate(prefill.rate === null ? "" : String(Number(prefill.rate.toPrecision(7))));
  }, [prefill]);

  const inst = prefill ? getSwingInstrument(prefill.symbol) : undefined;
  const quote = inst?.quote ?? "USD";
  const needsRate = quote !== "USD";

  const plan = useMemo(() => {
    const t = target.trim() === "" ? null : num(target);
    return planSwing({ account: num(account), riskPct: num(riskPct), entry: num(entry), stop: num(stop), target: t, side, atrPct: row?.atrPct ?? null, quoteToUsd: needsRate ? num(rate) : 1 });
  }, [account, riskPct, entry, stop, target, side, row, needsRate, rate]);

  const filled = entry.trim() !== "" && stop.trim() !== "";
  const lots = inst?.lotUnits && plan.ok ? plan.units / inst.lotUnits : null;
  return (
    <Card>
      <h2 className="text-base font-semibold text-text-1">Swing position planner{inst ? ` - ${inst.short}` : ""}</h2>
      <p className="mt-1 text-xs text-text-3">
        Decide the size from your risk limit before you look at the profit. Click a market in the map to fill the entry, a stop at the nearest level and a target at the next one.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Account size" value={account} onChange={setAccount} suffix="USD" />
        <Field label="Risk per trade" value={riskPct} onChange={setRiskPct} suffix="%" hint="0.5 to 1 is common" />
        <div className="text-xs text-text-2">
          Direction
          <div className="mt-1 inline-flex w-full rounded-lg border border-border p-0.5">
            {(["long", "short"] as PlanSide[]).map((s) => (
              <button key={s} type="button" onClick={() => setSide(s)} aria-pressed={side === s} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${side === s ? (s === "long" ? "bg-success/20 text-success" : "bg-danger/20 text-danger") : "text-text-2"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <Field label="Entry price" value={entry} onChange={setEntry} />
        <Field label="Stop price" value={stop} onChange={setStop} />
        <Field label="Target (optional)" value={target} onChange={setTarget} />
      </div>
      {needsRate ? (
        <div className="mt-3 max-w-xs">
          <Field label={`1 ${quote} in USD`} value={rate} onChange={setRate} hint={`${inst?.short ?? "This market"} is priced in ${quote}, so the risk is converted to USD. Filled from the map when available.`} />
        </div>
      ) : null}
      {filled && !plan.ok ? (
        <Alert tone="warning" title="Check the inputs" className="mt-4">
          {plan.errors.join(" ")}
        </Alert>
      ) : null}
      {filled && plan.ok ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="text-xs uppercase tracking-wide text-text-3">Size</div>
            <div className="mt-1 text-lg font-semibold text-text-1">{plan.units.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            <div className="text-xs text-text-2">
              units, worth {plan.notional.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
              {lots !== null ? ` (${lots.toFixed(2)} lots)` : ""}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="text-xs uppercase tracking-wide text-text-3">Risk if stopped</div>
            <div className="mt-1 text-lg font-semibold text-danger">-{plan.riskAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD</div>
            <div className="text-xs text-text-2">
              stop is {plan.stopDistancePct.toFixed(2)}% away &middot; leverage {plan.leverage.toFixed(2)}x
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="text-xs uppercase tracking-wide text-text-3">Stop vs daily range</div>
            {plan.stopAtr !== null ? (
              <>
                <div className={`mt-1 text-lg font-semibold ${plan.stopNote === "ok" ? "text-text-1" : "text-warning"}`}>{plan.stopAtr.toFixed(2)} ATR</div>
                <div className="text-xs text-text-2">{plan.stopNote === "tight" ? "Tight: a normal day can hit it." : plan.stopNote === "wide" ? "Wide: you risk a lot of distance for the size." : "Inside a normal daily range."}</div>
              </>
            ) : (
              <div className="mt-1 text-sm text-text-3">Pick a market in the map for the ATR.</div>
            )}
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="text-xs uppercase tracking-wide text-text-3">Reward to risk</div>
            {plan.rMultiple !== null ? (
              <>
                <div className="mt-1 text-lg font-semibold text-success">{plan.rMultiple.toFixed(2)} R</div>
                <div className="text-xs text-text-2">
                  +{(plan.rewardAmount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} USD if hit &middot; breaks even at a {(plan.breakEvenWinPct ?? 0).toFixed(0)}% win rate
                </div>
              </>
            ) : (
              <div className="mt-1 text-sm text-text-3">Add a target to see it.</div>
            )}
          </div>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-text-3">
        Arithmetic only, with the account in USD: it ignores spread, swap, commission and slippage, and a stop can fill worse than its price in a fast market. A broker&apos;s contract sizes differ,
        so check the lot value on your own platform before you trade.
      </p>
    </Card>
  );
}

const VERDICT_TONE: Record<string, string> = {
  "POSITIVE ON THIS HISTORY": "text-success",
  "NEGATIVE ON THIS HISTORY": "text-danger",
  "NO EDGE SHOWN": "text-text-2",
  COLLECTING: "text-text-3",
};

function ScoreLine({ label, row }: { label: string; row: SwingScoreRowDto }) {
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-3 text-text-1">{label}</td>
      <td className="py-2 pr-3 text-text-2">{row.n}</td>
      <td className="py-2 pr-3 text-text-2">{row.meanR === null ? "-" : row.meanR.toFixed(2)}</td>
      <td className="py-2 pr-3 text-text-2">{row.t === null ? "-" : row.t.toFixed(2)}</td>
      <td className="py-2 pr-3 text-text-3">{row.driftAtr === null ? "-" : `${row.driftAtr >= 0 ? "+" : ""}${row.driftAtr.toFixed(2)}`}</td>
      <td className={`py-2 font-medium ${VERDICT_TONE[row.verdict] ?? "text-text-2"}`}>{row.n < 30 ? `Collecting (${row.n}/30)` : row.verdict}</td>
    </tr>
  );
}

/** Forward scoreboard: after the map says aligned up or down, does price continue over the next 5 days? */
function ScoreboardCard({ state }: { state: LoadState<SwingScoreboard> }) {
  return (
    <Card className="mb-6">
      <h2 className="text-base font-semibold text-text-1">Does the map work? Forward scoreboard</h2>
      <p className="mt-1 text-xs text-text-3">
        Once a day, while a market is open, its weekly, daily and 4-hour alignment is recorded. Five days later we measure what price did, in units of the market&apos;s daily range (ATR): for
        &quot;aligned up&quot; the move up, for &quot;aligned down&quot; the move down, so a positive score means the trend continued. These are real forward results, not a backtest. Under 30 counted cases nothing is claimed.
      </p>
      {state.status === "loading" ? <Skeleton className="mt-4 h-32 w-full" /> : null}
      {state.status === "error" ? <div className="mt-3 text-sm text-text-3">{state.message}</div> : null}
      {state.status === "ready" ? (
        <div className="mt-3">
          <div className="text-xs text-text-3">
            {state.data.since ? `Recording since ${state.data.since.slice(0, 10)}. ` : "Nothing recorded yet. "}
            {state.data.done} snapshots scored, {state.data.open} waiting for their 5 days. The first scores appear 5 days after the first snapshot.
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="text-text-3">
                  <th className="pb-1 pr-3 font-medium">Scope</th>
                  <th className="pb-1 pr-3 font-medium">Cases</th>
                  <th className="pb-1 pr-3 font-medium">Mean score (ATR)</th>
                  <th className="pb-1 pr-3 font-medium">t</th>
                  <th className="pb-1 pr-3 font-medium">Drift of all days (ATR)</th>
                  <th className="pb-1 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                <ScoreLine label="All markets - aligned up" row={state.data.pooled.up} />
                <ScoreLine label="All markets - aligned down" row={state.data.pooled.down} />
                {state.data.groups.map((g) => (
                  <ScoreLine key={`${g.group}u`} label={`${SWING_GROUP_TITLE[g.group as SwingGroup]} - aligned up`} row={g.up} />
                ))}
                {state.data.groups.map((g) => (
                  <ScoreLine key={`${g.group}d`} label={`${SWING_GROUP_TITLE[g.group as SwingGroup]} - aligned down`} row={g.down} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-text-3">
        Drift is the average 5-day move of all recorded days, any alignment. In a rising market &quot;aligned up&quot; gets a free ride and &quot;aligned down&quot; is penalised, so compare the score with the drift.
        Markets also move together (the dollar), so the pooled rows count the same move more than once; a verdict needs at least 30 cases and |t| of 2.58 or more.
      </p>
    </Card>
  );
}

export default function SwingLabPage() {
  const [map, setMap] = useState<LoadState<SwingMapOverview>>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [board, setBoard] = useState<LoadState<SwingScoreboard>>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/private/swing-lab");
      const json = (await res.json().catch(() => null)) as { status?: string; data?: SwingMapOverview; error?: { message?: string } } | null;
      if (!res.ok || !json || json.status !== "ok" || !json.data) {
        setMap({ status: "error", message: json?.error?.message || "Could not load the swing map." });
        return;
      }
      setMap({ status: "ready", data: json.data });
    } catch {
      setMap({ status: "error", message: "Network error - could not reach the service." });
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/private/swing-lab/scoreboard");
      const json = (await res.json().catch(() => null)) as { status?: string; data?: SwingScoreboard } | null;
      if (!res.ok || !json || json.status !== "ok" || !json.data) {
        setBoard({ status: "error", message: "The scoreboard could not be loaded." });
        return;
      }
      setBoard({ status: "ready", data: json.data });
    } catch {
      setBoard({ status: "error", message: "The scoreboard could not be loaded." });
    }
  }, []);

  useEffect(() => {
    void loadBoard();
    const id = window.setInterval(() => void loadBoard(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadBoard]);

  const priceOf = useCallback(
    (symbol: string): number | null => {
      if (map.status !== "ready") return null;
      const r = map.data.rows.find((x) => x.symbol === symbol);
      return r && r.status === "ok" ? r.data.price : null;
    },
    [map],
  );

  const pick = (row: SwingMapRow) => {
    setSelected(row.symbol);
    // Direction follows the daily trend; a mixed trend defaults to long. This only prefills the form, it is not advice.
    const side: PlanSide = row.d1 === "down" ? "short" : "long";
    const stop = side === "long" ? row.support?.price ?? null : row.resistance?.price ?? null;
    const target = side === "long" ? row.resistance?.price ?? null : row.support?.price ?? null;
    const quote = getSwingInstrument(row.symbol)?.quote ?? "USD";
    setPrefill({ symbol: row.symbol, entry: Number(row.price.toPrecision(7)), stop, target, side, rate: quoteRate(quote, priceOf) });
  };

  const rows = map.status === "ready" ? map.data.rows : [];
  const okRow = (symbol: string): SwingMapRow | null => {
    const r = rows.find((x) => x.symbol === symbol);
    return r && r.status === "ok" ? r.data : null;
  };
  const selectedRow = selected ? okRow(selected) : null;
  const notConnected = rows.filter((r) => r.status === "unavailable" && r.reason === "not_connected").map((r) => getSwingInstrument(r.symbol)?.short ?? r.symbol);

  return (
    <div>
      <PageHeader
        eyebrow="Intelligence"
        title="Swing Lab"
        description="Process tools for swing trading forex pairs, metals, energy and stock indices: where the weekly, daily and 4-hour trends stand, the nearest levels in ATR units, and a planner that turns your risk limit and stop into a size."
      />
      <Alert tone="info" title="How to read it" className="mb-6">
        Trend per timeframe: price above its 20-bar average and that above the 50-bar average is up, the reverse is down, anything else is mixed. Levels are daily swing highs
        and lows, the previous week&apos;s high and low and the 20-day range; distances are in daily ATR, the usual size of a day&apos;s move. This is a map, not a signal: our own tests
        of the popular daily swing rules (trend, pullback, breakout, oversold) found no edge on BTC, ETH or gold, so nothing here says buy or sell. What it helps with is the process: where
        you are, how far the next level is, and how big to trade. Crypto is on the Crypto Flow page.
      </Alert>
      {map.status === "error" ? (
        <ErrorState
          title="Could not load the swing map"
          description={map.message}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : null}
      {map.status === "loading" ? <Skeleton className="h-96 w-full" /> : null}
      {map.status === "ready"
        ? GROUPS.map((group) => {
            const list = SWING_INSTRUMENTS.filter((i) => i.group === group).filter((i) => {
              const r = rows.find((x) => x.symbol === i.symbol);
              return !(r && r.status === "unavailable" && r.reason === "not_connected");
            });
            if (list.length === 0) return null;
            return (
              <Card key={group} className="mb-6">
                <h2 className="text-base font-semibold text-text-1">{SWING_GROUP_TITLE[group]}</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-sm">
                    <thead>
                      <tr className="text-xs text-text-3">
                        <th className="pb-2 pr-3 font-medium">Market</th>
                        <th className="pb-2 pr-3 font-medium">Price</th>
                        <th className="pb-2 pr-3 font-medium">Daily range</th>
                        <th className="pb-2 pr-3 font-medium">Trend</th>
                        <th className="pb-2 pr-3 font-medium">Resistance</th>
                        <th className="pb-2 pr-3 font-medium">Support</th>
                        <th className="pb-2 font-medium">In 50-day range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((inst) => {
                        const r = rows.find((x) => x.symbol === inst.symbol);
                        if (!r || r.status !== "ok") {
                          return (
                            <tr key={inst.symbol} className="border-t border-border">
                              <td className="py-2 pr-3 text-text-1">{inst.short}</td>
                              <td className="py-2 text-text-3" colSpan={6}>
                                {r?.status === "unavailable" ? r.message : "Temporarily unavailable"}
                              </td>
                            </tr>
                          );
                        }
                        const d = r.data;
                        return (
                          <tr key={inst.symbol} onClick={() => pick(d)} className={`cursor-pointer border-t border-border hover:bg-surface-2 ${selected === inst.symbol ? "bg-surface-2" : ""}`}>
                            <td className="py-2 pr-3">
                              <div className="font-medium text-text-1">{inst.short}</div>
                              <div className="text-xs text-text-3">{isClosed(d.asOfBar) ? "market closed" : inst.label}</div>
                            </td>
                            <td className="py-2 pr-3 text-text-1">{fmtPrice(d.price)}</td>
                            <td className="py-2 pr-3 text-text-2">{d.atrPct.toFixed(2)}%</td>
                            <td className="py-2 pr-3">
                              <div className="flex flex-wrap gap-1">
                                <TrendChip label="W" trend={d.w1} />
                                <TrendChip label="D" trend={d.d1} />
                                <TrendChip label="4H" trend={d.h4} />
                              </div>
                              <div className={`mt-0.5 text-xs ${ALIGN_TONE[d.alignment]}`}>{d.alignment}</div>
                            </td>
                            <td className="py-2 pr-3">
                              <LevelCell level={d.resistance} side="resistance" />
                            </td>
                            <td className="py-2 pr-3">
                              <LevelCell level={d.support} side="support" />
                            </td>
                            <td className="py-2">
                              <RangeBar pct={d.rangePosPct} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })
        : null}
      {map.status === "ready" ? (
        <p className="mb-6 text-xs text-text-3">
          Click a market to fill the planner. Prices are the broker feed of the AT24 data bridge and refresh every 5 minutes. ATR is the average daily range of the last 14 days; a level less than half an ATR from the price is
          inside a normal day&apos;s noise.
          {notConnected.length > 0 ? ` Not connected yet: ${notConnected.join(", ")}.` : ""}
        </p>
      ) : null}
      <Planner row={selectedRow} prefill={prefill} />
      <div className="mt-6">
        <ScoreboardCard state={board} />
      </div>
      <p className="mt-6 text-xs text-text-3">Context and arithmetic, not financial advice.</p>
    </div>
  );
}
