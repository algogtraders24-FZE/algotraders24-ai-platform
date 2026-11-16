// app/dashboard/swing-lab/page.tsx
// Swing Lab - process tools for swing trading: a weekly / daily / 4-hour trend and key-level map for the Crypto Flow markets,
// and a position planner that turns a risk limit and a stop into a size. Descriptive, not a signal: our own tests found no edge in
// the popular daily swing rules, so nothing here says "buy" or "sell". Data: public Binance bars.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";
import { CRYPTO_FLOW_INSTRUMENTS, getCryptoFlowInstrument } from "@/types/crypto-flow";
import type { SwingLevel, SwingMapOverview, SwingMapRow, SwingTrend } from "@/types/swing-lab";
import { planSwing, type PlanSide } from "@/services/swing-lab/planner";

type LoadState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

const REFRESH_MS = 5 * 60_000;

function fmtPrice(v: number): string {
  const digits = v >= 100 ? 2 : v >= 1 ? 3 : 5;
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
      {label} {trend === "up" ? "up" : trend === "down" ? "down" : trend === "mixed" ? "mixed" : "-"}
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
        <span>{pct.toFixed(0)}%</span>
        <span>high</span>
      </div>
    </div>
  );
}

const ALIGN_TONE: Record<SwingMapRow["alignment"], string> = { "aligned up": "text-success", "aligned down": "text-danger", mixed: "text-text-2" };

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

/** Position planner: a risk limit and a stop become a size. Pure arithmetic in the browser, nothing is saved or sent. */
function Planner({ row, prefill }: { row: SwingMapRow | null; prefill: { entry: number; stop: number | null; target: number | null; side: PlanSide } | null }) {
  const [account, setAccount] = useState("10000");
  const [riskPct, setRiskPct] = useState("1");
  const [side, setSide] = useState<PlanSide>("long");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");

  useEffect(() => {
    if (!prefill) return;
    setSide(prefill.side);
    setEntry(String(prefill.entry));
    setStop(prefill.stop === null ? "" : String(prefill.stop));
    setTarget(prefill.target === null ? "" : String(prefill.target));
  }, [prefill]);

  const plan = useMemo(() => {
    const t = target.trim() === "" ? null : num(target);
    return planSwing({ account: num(account), riskPct: num(riskPct), entry: num(entry), stop: num(stop), target: t, side, atrPct: row?.atrPct ?? null });
  }, [account, riskPct, entry, stop, target, side, row]);

  const filled = entry.trim() !== "" && stop.trim() !== "";
  return (
    <Card>
      <h2 className="text-base font-semibold text-text-1">Swing position planner</h2>
      <p className="mt-1 text-xs text-text-3">Decide the size from your risk limit before you look at the profit. Click a market in the map to fill the entry, a stop at the nearest level and a target at the next one.</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Account size" value={account} onChange={setAccount} suffix="USDT" />
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
      {filled && !plan.ok ? (
        <Alert tone="warning" title="Check the inputs" className="mt-4">
          {plan.errors.join(" ")}
        </Alert>
      ) : null}
      {filled && plan.ok ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="text-xs uppercase tracking-wide text-text-3">Size</div>
            <div className="mt-1 text-lg font-semibold text-text-1">{plan.units.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
            <div className="text-xs text-text-2">units, worth {plan.notional.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDT</div>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="text-xs uppercase tracking-wide text-text-3">Risk if stopped</div>
            <div className="mt-1 text-lg font-semibold text-danger">-{plan.riskAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            <div className="text-xs text-text-2">stop is {plan.stopDistancePct.toFixed(2)}% away &middot; leverage {plan.leverage.toFixed(2)}x</div>
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
                  +{(plan.rewardAmount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} if hit &middot; breaks even at a {(plan.breakEvenWinPct ?? 0).toFixed(0)}% win rate
                </div>
              </>
            ) : (
              <div className="mt-1 text-sm text-text-3">Add a target to see it.</div>
            )}
          </div>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-text-3">Arithmetic only: it ignores fees, slippage and funding, and a stop can fill worse than its price in a fast market.</p>
    </Card>
  );
}

export default function SwingLabPage() {
  const [map, setMap] = useState<LoadState<SwingMapOverview>>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ entry: number; stop: number | null; target: number | null; side: PlanSide } | null>(null);

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

  const pick = (row: SwingMapRow) => {
    setSelected(row.symbol);
    // Direction follows the daily trend; a mixed trend defaults to long. This only prefills the form, it is not advice.
    const side: PlanSide = row.d1 === "down" ? "short" : "long";
    const stop = side === "long" ? row.support?.price ?? null : row.resistance?.price ?? null;
    const target = side === "long" ? row.resistance?.price ?? null : row.support?.price ?? null;
    setPrefill({ entry: Number(row.price.toPrecision(7)), stop, target, side });
  };

  const selectedRow = map.status === "ready" ? ((map.data.rows.find((r) => r.symbol === selected && r.status === "ok") as { data: SwingMapRow } | undefined)?.data ?? null) : null;

  return (
    <div>
      <PageHeader
        eyebrow="Intelligence"
        title="Swing Lab"
        description="Process tools for swing trading: where the weekly, daily and 4-hour trends stand, the nearest levels in ATR units, and a planner that turns your risk limit and stop into a size."
      />
      <Alert tone="info" title="How to read it" className="mb-6">
        Trend per timeframe: price above its 20-bar average and that above the 50-bar average is up, the reverse is down, anything else is mixed. Levels are daily swing
        highs and lows, the previous week&apos;s high and low and the 20-day range; distances are in daily ATR, the usual size of a day&apos;s move. This is a map, not a signal:
        our own tests of the popular daily swing rules (trend, pullback, breakout, oversold) found no edge on BTC, ETH or gold, so nothing here says buy or sell. What it
        helps with is the process: where you are, how far the next level is, and how big to trade.
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
      {map.status === "ready" ? (
        <Card className="mb-6">
          <h2 className="text-base font-semibold text-text-1">Trend and level map</h2>
          <p className="mb-3 mt-1 text-xs text-text-3">Click a market to fill the planner. Binance spot (gold and silver are the perpetual futures). Refreshes every 5 minutes.</p>
          <div className="overflow-x-auto">
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
                {CRYPTO_FLOW_INSTRUMENTS.map((inst) => {
                  const r = map.data.rows.find((x) => x.symbol === inst.symbol);
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
                        <div className="text-xs text-text-3">{getCryptoFlowInstrument(inst.symbol)?.label}</div>
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
          <p className="mt-3 text-xs text-text-3">ATR = the average daily range of the last 14 days. A level less than half an ATR from the price is inside a normal day&apos;s noise.</p>
        </Card>
      ) : null}
      <Planner row={selectedRow} prefill={prefill} />
      <p className="mt-6 text-xs text-text-3">Source: Binance public market data (daily and 4-hour bars). Context and arithmetic, not financial advice.</p>
    </div>
  );
}
