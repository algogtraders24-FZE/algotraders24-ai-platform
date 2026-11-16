// app/dashboard/market-board/page.tsx
// Market Board - a live candle chart with AT24 indicators attached (Zone Pro supply and demand zones, Divergence Pro RSI divergence), each with the
// scorecard of how it did on that chart's own history, plus a market heatmap and a correlation shift table.
// Descriptive, not a signal: the scorecards say "no edge shown" unless a result is beyond luck, and nothing here says "buy" or "sell".
// Data: Exness candles (Exness Trading API first, the AT24 MT5 data bridge as backup), read-only. Refreshes every 10 seconds (chart) and 5 minutes (tables).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import ErrorState from "@/components/ui/ErrorState";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import {
  BOARD_INSTRUMENTS, BOARD_TIMEFRAMES, getBoardInstrument, type BoardChartDto, type BoardOverviewDto, type BoardOverviewRow, type BoardTimeframe,
} from "@/types/market-board";
import type { Score, VerdictKind } from "@/services/market-board/indicators";

type LoadState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

const CHART_REFRESH_MS = 10_000;
const OVERVIEW_REFRESH_MS = 5 * 60_000;

function fmtPrice(v: number): string {
  const digits = v >= 1000 ? 2 : v >= 100 ? 3 : v >= 10 ? 4 : 5;
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
const tone = (v: number) => (v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-text-2");

const VERDICT_TEXT: Record<VerdictKind, string> = { too_few: "Too few", positive: "Positive on this history", negative: "Negative on this history", no_edge: "No edge shown" };
const VERDICT_TONE: Record<VerdictKind, string> = {
  too_few: "border-border bg-surface-2 text-text-3",
  positive: "border-success/40 bg-success/10 text-success",
  negative: "border-danger/40 bg-danger/10 text-danger",
  no_edge: "border-border bg-surface-2 text-text-2",
};

function Verdict({ score }: { score: Score }) {
  const text = score.verdict === "too_few" ? `Too few (${score.n} of 30)` : VERDICT_TEXT[score.verdict];
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${VERDICT_TONE[score.verdict]}`}>{text}</span>;
}

function ScoreLine({ label, score, unit }: { label: string; score: Score; unit: string }) {
  return (
    <div className="border-t border-border py-2 first:border-t-0">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <Verdict score={score} />
      </div>
      <p className="mt-1 text-xs text-text-3">
        {score.n} {unit}, hit {score.hitPct.toFixed(0)}%, average {score.avgR >= 0 ? "+" : ""}
        {score.avgR.toFixed(2)} R after cost
        {score.verdict !== "too_few" ? `, luck test p ${score.pFlip.toFixed(2)}` : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Candle chart with the indicator overlays (SVG, closed candles plus the forming one)
// ---------------------------------------------------------------------------------------------------------------------
const W = 860;
const H = 420;
const PAD_L = 8;
const PAD_R = 64;
const PAD_T = 10;
const PAD_B = 24;

function ChartSvg({ chart, showZones, showDiv }: { chart: BoardChartDto; showZones: boolean; showDiv: boolean }) {
  const candles = useMemo(() => (chart.forming ? [...chart.candles, chart.forming] : chart.candles), [chart]);
  const n = candles.length;
  const times = useMemo(() => new Map(candles.map((c, i) => [c.time, i])), [candles]);

  const zones = useMemo(() => (showZones ? chart.zones.fresh : []), [showZones, chart]);
  const divs = useMemo(() => (showDiv ? chart.divergences.recent : []), [showDiv, chart]);

  const geom = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      lo = Math.min(lo, c.low);
      hi = Math.max(hi, c.high);
    }
    for (const z of zones) {
      lo = Math.min(lo, z.bottom);
      hi = Math.max(hi, z.top);
    }
    const span = hi - lo || 1;
    lo -= span * 0.04;
    hi += span * 0.04;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const step = plotW / Math.max(n, 1);
    return {
      lo,
      hi,
      step,
      x: (i: number) => PAD_L + step * (i + 0.5),
      y: (v: number) => PAD_T + ((hi - v) / (hi - lo)) * plotH,
    };
  }, [candles, zones, n]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let k = 0; k <= 4; k++) out.push(geom.lo + ((geom.hi - geom.lo) * k) / 4);
    return out;
  }, [geom]);

  const lastClose = candles[candles.length - 1]?.close;
  const firstTime = candles[0]?.time ? Date.parse(candles[0].time) : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${chart.symbol} candles with Zone Pro and Divergence Pro overlays`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD_L} x2={W - PAD_R} y1={geom.y(t)} y2={geom.y(t)} stroke="currentColor" strokeOpacity={0.12} />
          <text x={W - PAD_R + 6} y={geom.y(t) + 4} fontSize={11} fill="currentColor" fillOpacity={0.6}>
            {fmtPrice(t)}
          </text>
        </g>
      ))}

      {zones.map((z, i) => {
        const startIdx = times.get(z.time);
        const x0 = startIdx === undefined ? (Date.parse(z.time) < firstTime ? PAD_L : null) : geom.x(startIdx);
        if (x0 === null) return null;
        const col = z.dir > 0 ? "#1D9E75" : "#D85A30";
        const top = geom.y(z.top);
        const bottom = geom.y(z.bottom);
        return (
          <g key={`z${i}`}>
            <rect x={x0} y={top} width={W - PAD_R - x0} height={Math.max(2, bottom - top)} fill={col} fillOpacity={0.16} stroke={col} strokeOpacity={0.6} strokeWidth={1} />
            <text x={x0 + 4} y={top + 12} fontSize={11} fill={col}>
              {z.dir > 0 ? "demand" : "supply"}
            </text>
          </g>
        );
      })}

      {candles.map((c, i) => {
        const up = c.close >= c.open;
        const col = up ? "#1D9E75" : "#E24B4A";
        const isForming = chart.forming !== null && i === n - 1;
        const bodyTop = geom.y(Math.max(c.open, c.close));
        const bodyH = Math.max(1.5, Math.abs(geom.y(c.open) - geom.y(c.close)));
        const bw = Math.max(1.5, geom.step * 0.62);
        return (
          <g key={c.time} opacity={isForming ? 0.55 : 1}>
            <line x1={geom.x(i)} x2={geom.x(i)} y1={geom.y(c.high)} y2={geom.y(c.low)} stroke={col} strokeWidth={1} />
            <rect x={geom.x(i) - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={col} />
          </g>
        );
      })}

      {divs.map((d, i) => {
        const a = times.get(d.prevSwingTime);
        const b = times.get(d.swingTime);
        if (a === undefined || b === undefined) return null;
        const col = d.dir > 0 ? "#534AB7" : "#BA7517";
        return (
          <g key={`d${i}`}>
            <line x1={geom.x(a)} y1={geom.y(d.prevSwingPrice)} x2={geom.x(b)} y2={geom.y(d.swingPrice)} stroke={col} strokeWidth={2} />
            <text x={geom.x(b) + 4} y={geom.y(d.swingPrice) + (d.dir > 0 ? 14 : -6)} fontSize={11} fill={col}>
              {d.dir > 0 ? "bullish divergence" : "bearish divergence"}
            </text>
          </g>
        );
      })}

      {lastClose !== undefined ? (
        <g>
          <line x1={PAD_L} x2={W - PAD_R} y1={geom.y(lastClose)} y2={geom.y(lastClose)} stroke="currentColor" strokeOpacity={0.5} strokeDasharray="3 3" />
          <rect x={W - PAD_R + 2} y={geom.y(lastClose) - 9} width={60} height={18} rx={3} fill="currentColor" fillOpacity={0.85} />
          <text x={W - PAD_R + 6} y={geom.y(lastClose) + 4} fontSize={11} style={{ fill: "var(--surface-2, #fff)" }}>
            {fmtPrice(lastClose)}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------------------------------
function trendChip(trend: "up" | "down" | "range") {
  const cls = trend === "up" ? "text-success" : trend === "down" ? "text-danger" : "text-text-3";
  return <span className={cls}>{trend === "up" ? "Up" : trend === "down" ? "Down" : "Range"}</span>;
}

const SHIFT_TEXT = { normal: "Normal", shifted_up: "Shifted up", shifted_down: "Shifted down", extreme: "At an extreme" } as const;

export default function MarketBoardPage() {
  const [symbol, setSymbol] = useState("XAUUSD");
  const [interval, setIntervalId] = useState<BoardTimeframe>("15m");
  const [showZones, setShowZones] = useState(true);
  const [showDiv, setShowDiv] = useState(true);
  const [chart, setChart] = useState<LoadState<BoardChartDto>>({ status: "loading" });
  const [overview, setOverview] = useState<LoadState<BoardOverviewDto>>({ status: "loading" });

  const loadChart = useCallback(async () => {
    try {
      const res = await fetch(`/api/private/market-board/chart?symbol=${encodeURIComponent(symbol)}&interval=${interval}`);
      const json = (await res.json().catch(() => null)) as { status?: string; data?: BoardChartDto; error?: { message?: string } } | null;
      if (res.ok && json?.status === "ok" && json.data) setChart({ status: "ready", data: json.data });
      else setChart((prev) => (prev.status === "ready" ? prev : { status: "error", message: json?.error?.message ?? "This market is temporarily unavailable" }));
    } catch {
      setChart((prev) => (prev.status === "ready" ? prev : { status: "error", message: "Could not reach the server" }));
    }
  }, [symbol, interval]);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/private/market-board/overview");
      const json = (await res.json().catch(() => null)) as { status?: string; data?: BoardOverviewDto; error?: { message?: string } } | null;
      if (res.ok && json?.status === "ok" && json.data) setOverview({ status: "ready", data: json.data });
      else setOverview((prev) => (prev.status === "ready" ? prev : { status: "error", message: json?.error?.message ?? "Temporarily unavailable" }));
    } catch {
      setOverview((prev) => (prev.status === "ready" ? prev : { status: "error", message: "Could not reach the server" }));
    }
  }, []);

  useEffect(() => {
    setChart({ status: "loading" });
    void loadChart();
    const id = window.setInterval(() => void loadChart(), CHART_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadChart]);

  useEffect(() => {
    void loadOverview();
    const id = window.setInterval(() => void loadOverview(), OVERVIEW_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadOverview]);

  const inst = getBoardInstrument(symbol);
  const data = chart.status === "ready" ? chart.data : null;
  const nearest = useMemo(() => {
    if (!data) return { demand: null, supply: null };
    const px = data.forming?.close ?? data.candles[data.candles.length - 1]?.close ?? 0;
    const dem = data.zones.fresh.filter((z) => z.dir > 0 && z.top < px).sort((a, b) => b.top - a.top)[0] ?? null;
    const sup = data.zones.fresh.filter((z) => z.dir < 0 && z.bottom > px).sort((a, b) => a.bottom - b.bottom)[0] ?? null;
    return { demand: dem, supply: sup };
  }, [data]);

  const sortedRows = useMemo<BoardOverviewRow[]>(() => {
    if (overview.status !== "ready") return [];
    return [...overview.data.rows].sort((a, b) => {
      const av = a.status === "ok" ? Math.abs(a.data.moveAtr) : -1;
      const bv = b.status === "ok" ? Math.abs(b.data.moveAtr) : -1;
      return bv - av;
    });
  }, [overview]);

  return (
    <div>
      <PageHeader
        eyebrow="Market Board"
        title="Live chart with AT24 indicators"
        description="Zone Pro and Divergence Pro on a live chart, each with how it did on that chart's own history, plus a market heatmap and correlation shifts. Descriptive context, not a signal."
      />

      <Alert tone="info" title="How to read it" className="mb-6">
        Zones and divergences are known only after their bars have closed (nothing repaints). The scorecards show how the first retest of past zones, and each past divergence, would have turned out
        in R after cost. A verdict says positive or negative only when the result is beyond luck; otherwise it says no edge shown. Past results do not predict future results. Not financial advice.
      </Alert>

      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {BOARD_INSTRUMENTS.map((i) => (
            <button
              key={i.symbol}
              type="button"
              onClick={() => setSymbol(i.symbol)}
              className={`rounded-md border px-3 py-1 text-sm ${i.symbol === symbol ? "border-gold bg-surface-2 font-medium" : "border-border text-text-2 hover:bg-surface-2"}`}
            >
              {i.short}
            </button>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {BOARD_TIMEFRAMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setIntervalId(t.id)}
              className={`rounded-md border px-2.5 py-0.5 ${t.id === interval ? "border-gold bg-surface-2 font-medium" : "border-border text-text-2 hover:bg-surface-2"}`}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-text-3">
            {inst?.label} &middot; bid &middot; updates every 10 s{data ? ` &middot; ${data.source === "exness" ? "Exness API" : "AT24 data bridge"}` : ""}
          </span>
        </div>

        {chart.status === "error" ? (
          <ErrorState title="Chart unavailable" description={chart.message} action={<Button variant="secondary" onClick={() => void loadChart()}>Try again</Button>} />
        ) : chart.status === "loading" ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-md border border-border bg-surface-1 p-2 text-text">
              <ChartSvg chart={chart.data} showZones={showZones} showDiv={showDiv} />
            </div>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border p-3">
                <p className="mb-2 font-medium">Indicators on chart</p>
                <label className="flex cursor-pointer items-center justify-between py-1">
                  <span>Zone Pro</span>
                  <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} />
                </label>
                <label className="flex cursor-pointer items-center justify-between py-1">
                  <span>Divergence Pro</span>
                  <input type="checkbox" checked={showDiv} onChange={(e) => setShowDiv(e.target.checked)} />
                </label>
                <p className="mt-2 text-xs text-text-3">More indicators are in the AT24 marketplace for MetaTrader 5, MetaTrader 4 and TradingView.</p>
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="mb-1 font-medium">Zone Pro scorecard</p>
                <p className="mb-1 text-xs text-text-3">First retest of past zones on this chart ({chart.data.barsAnalysed} bars, cost {chart.data.costUsed.toFixed(chart.data.costUsed < 1 ? 4 : 2)})</p>
                <ScoreLine label="Demand" score={chart.data.zones.scores.demand} unit="retests" />
                <ScoreLine label="Supply" score={chart.data.zones.scores.supply} unit="retests" />
                <ScoreLine label="All zones" score={chart.data.zones.scores.all} unit="retests" />
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="mb-1 font-medium">Plan for the nearest fresh zone</p>
                {(["supply", "demand"] as const).map((side) => {
                  const z = nearest[side];
                  return (
                    <p key={side} className="py-0.5 text-xs">
                      <span className={side === "demand" ? "text-success" : "text-danger"}>{side === "demand" ? "Demand below" : "Supply above"}:</span>{" "}
                      {z ? `${z.plan.side} limit ${fmtPrice(z.plan.limit)}, stop ${fmtPrice(z.plan.stop)}, target ${fmtPrice(z.plan.target)}` : "none fresh"}
                    </p>
                  );
                })}
                <p className="mt-1 text-xs text-text-3">{chart.data.zones.touchedOnLastBar ? "A zone was touched on the last closed bar." : "No zone touched on the last closed bar."}</p>
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="mb-1 font-medium">Divergence Pro scorecard</p>
                <p className="mb-1 text-xs text-text-3">
                  {chart.data.divergences.live
                    ? "plan" in chart.data.divergences.live && chart.data.divergences.live.plan === null
                      ? `A ${chart.data.divergences.live.dir > 0 ? "bullish" : "bearish"} divergence was confirmed on the last closed bar (no plan: stop too far).`
                      : `A ${chart.data.divergences.live.dir > 0 ? "bullish" : "bearish"} divergence was confirmed on the last closed bar.`
                    : "No divergence on the last closed bar."}
                </p>
                <ScoreLine label="Bullish" score={chart.data.divergences.scores.bullish} unit="trades" />
                <ScoreLine label="Bearish" score={chart.data.divergences.scores.bearish} unit="trades" />
                <ScoreLine label="All" score={chart.data.divergences.scores.all} unit="trades" />
              </div>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-base font-semibold">Heatmap, sorted by last daily move in ATR</h2>
          <p className="mb-3 text-xs text-text-3">Daily bars. Changes use closed bars; move in ATR is the last closed daily move measured in ATRs of the day before.</p>
          {overview.status === "loading" ? <Skeleton className="h-64 w-full" /> : null}
          {overview.status === "error" ? <ErrorState title="Heatmap unavailable" description={overview.message} action={<Button variant="secondary" onClick={() => void loadOverview()}>Try again</Button>} /> : null}
          {overview.status === "ready" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-3">
                    <th className="py-1 pr-2 font-medium">Market</th>
                    <th className="py-1 pr-2 text-right font-medium">Last</th>
                    <th className="py-1 pr-2 text-right font-medium">1D</th>
                    <th className="py-1 pr-2 text-right font-medium">5D</th>
                    <th className="py-1 pr-2 text-right font-medium">21D</th>
                    <th className="py-1 pr-2 text-right font-medium">Move/ATR</th>
                    <th className="py-1 pr-2 font-medium">Trend</th>
                    <th className="py-1 pr-2 text-right font-medium">RSI</th>
                    <th className="py-1 text-right font-medium">52w</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => {
                    const meta = getBoardInstrument(r.symbol);
                    if (r.status !== "ok") {
                      return (
                        <tr key={r.symbol} className="border-t border-border">
                          <td className="py-1.5 pr-2 font-medium">{meta?.short ?? r.symbol}</td>
                          <td colSpan={8} className="py-1.5 text-xs text-text-3">
                            {r.message}
                          </td>
                        </tr>
                      );
                    }
                    const d = r.data;
                    return (
                      <tr key={r.symbol} className="border-t border-border">
                        <td className="py-1.5 pr-2 font-medium">
                          <button type="button" className="hover:underline" onClick={() => setSymbol(r.symbol)}>
                            {meta?.short ?? r.symbol}
                          </button>
                        </td>
                        <td className="py-1.5 pr-2 text-right">{fmtPrice(d.last)}</td>
                        <td className={`py-1.5 pr-2 text-right ${tone(d.change1dPct)}`}>{fmtPct(d.change1dPct)}</td>
                        <td className={`py-1.5 pr-2 text-right ${tone(d.change5dPct)}`}>{fmtPct(d.change5dPct)}</td>
                        <td className={`py-1.5 pr-2 text-right ${tone(d.change21dPct)}`}>{fmtPct(d.change21dPct)}</td>
                        <td className={`py-1.5 pr-2 text-right ${Math.abs(d.moveAtr) >= 2 ? "font-semibold text-gold" : ""}`}>
                          {d.moveAtr >= 0 ? "+" : ""}
                          {d.moveAtr.toFixed(1)}
                          {Math.abs(d.moveAtr) >= 2 ? " !" : ""}
                        </td>
                        <td className="py-1.5 pr-2">{trendChip(d.trend)}</td>
                        <td className="py-1.5 pr-2 text-right">{d.rsi.toFixed(0)}</td>
                        <td className="py-1.5 text-right">{d.rangePct.toFixed(0)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-1 text-base font-semibold">Correlation shift</h2>
          <p className="mb-3 text-xs text-text-3">Correlation of daily returns, 20 days against 120 days. Percentile = where today&apos;s 20-day value sits among its own history.</p>
          {overview.status === "loading" ? <Skeleton className="h-64 w-full" /> : null}
          {overview.status === "error" ? <ErrorState title="Correlations unavailable" description={overview.message} action={<Button variant="secondary" onClick={() => void loadOverview()}>Try again</Button>} /> : null}
          {overview.status === "ready" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-3">
                    <th className="py-1 pr-2 font-medium">Pair</th>
                    <th className="py-1 pr-2 text-right font-medium">20d</th>
                    <th className="py-1 pr-2 text-right font-medium">120d</th>
                    <th className="py-1 pr-2 text-right font-medium">Change</th>
                    <th className="py-1 pr-2 text-right font-medium">Percentile</th>
                    <th className="py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.pairs.map((p) => {
                    const name = `${getBoardInstrument(p.a)?.short ?? p.a} / ${getBoardInstrument(p.b)?.short ?? p.b}`;
                    if (p.status !== "ok" || !p.data || !p.shift) {
                      return (
                        <tr key={`${p.a}${p.b}`} className="border-t border-border">
                          <td className="py-1.5 pr-2 font-medium">{name}</td>
                          <td colSpan={5} className="py-1.5 text-xs text-text-3">
                            Temporarily unavailable
                          </td>
                        </tr>
                      );
                    }
                    const shifted = p.shift === "shifted_up" || p.shift === "shifted_down";
                    return (
                      <tr key={`${p.a}${p.b}`} className="border-t border-border">
                        <td className="py-1.5 pr-2 font-medium">{name}</td>
                        <td className="py-1.5 pr-2 text-right">{p.data.short.toFixed(2)}</td>
                        <td className="py-1.5 pr-2 text-right">{p.data.long.toFixed(2)}</td>
                        <td className={`py-1.5 pr-2 text-right ${shifted ? "font-semibold text-gold" : ""}`}>
                          {p.data.delta >= 0 ? "+" : ""}
                          {p.data.delta.toFixed(2)}
                        </td>
                        <td className="py-1.5 pr-2 text-right">{p.data.percentile.toFixed(0)}%</td>
                        <td className={`py-1.5 ${shifted ? "font-medium text-gold" : p.shift === "extreme" ? "text-warning" : "text-text-2"}`}>{SHIFT_TEXT[p.shift]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {overview.status === "ready" ? (
            <p className="mt-3 text-xs text-text-3">A pair counts as shifted when the 20-day and 120-day correlations differ by {overview.data.shiftLevel.toFixed(2)} or more.</p>
          ) : null}
        </Card>
      </div>

      <p className="mt-6 text-xs text-text-3">
        Descriptive market overview, not a signal or a forecast. No trades are placed. Past results do not predict future results. Not financial advice.
      </p>
    </div>
  );
}
