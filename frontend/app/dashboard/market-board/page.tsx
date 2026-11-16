// app/dashboard/market-board/page.tsx
// Market Board - a live candle chart with AT24 indicators attached (Zone Pro, Divergence Pro, Absorption Map, Setup Pro, FVG Zones, Order Block Lab,
// Volume Profile Levels), each with the scorecard or statistics of how it did on that chart's own history, plus a market heatmap and a correlation shift table.
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

type IndKey = "zones" | "divergence" | "absorption" | "setups" | "fvg" | "ob" | "vp" | "structure" | "expected";
type OnMap = Record<IndKey, boolean>;

const INDICATORS: ReadonlyArray<{ key: IndKey; label: string }> = [
  { key: "zones", label: "Zone Pro" },
  { key: "divergence", label: "Divergence Pro" },
  { key: "absorption", label: "Absorption Map" },
  { key: "setups", label: "Setup Pro" },
  { key: "fvg", label: "FVG Zones" },
  { key: "ob", label: "Order Block Lab" },
  { key: "vp", label: "Volume Profile Levels" },
  { key: "structure", label: "Market Structure" },
  { key: "expected", label: "Expected Range" },
];

function ChartSvg({ chart, on }: { chart: BoardChartDto; on: OnMap }) {
  const candles = useMemo(() => (chart.forming ? [...chart.candles, chart.forming] : chart.candles), [chart]);
  const n = candles.length;
  const times = useMemo(() => new Map(candles.map((c, i) => [c.time, i])), [candles]);

  const zones = useMemo(() => (on.zones ? chart.zones.fresh : []), [on.zones, chart]);
  const divs = useMemo(() => (on.divergence ? chart.divergences.recent : []), [on.divergence, chart]);
  const absZones = useMemo(() => (on.absorption ? chart.absorption.fresh : []), [on.absorption, chart]);
  const fvgs = useMemo(() => (on.fvg ? chart.fvg.open : []), [on.fvg, chart]);
  const obs = useMemo(() => (on.ob ? chart.orderBlocks.fresh : []), [on.ob, chart]);
  const setups = useMemo(() => (on.setups ? chart.setups : null), [on.setups, chart]);
  const vp = on.vp ? chart.volumeProfile?.levels ?? null : null;
  const structure = on.structure ? chart.structure.recent : [];
  const er = on.expected ? chart.expectedRange?.today ?? null : null;

  const geom = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      lo = Math.min(lo, c.low);
      hi = Math.max(hi, c.high);
    }
    // Overlay boxes widen the range only when they are close to the candles (within 30 % of their range); farther ones are clipped or skipped.
    const base = hi - lo || 1;
    const near = base * 0.3;
    const cLo = lo;
    const cHi = hi;
    for (const z of [...zones, ...absZones, ...fvgs, ...obs]) {
      if (z.top >= cLo - near && z.bottom <= cHi + near) {
        lo = Math.min(lo, z.bottom);
        hi = Math.max(hi, z.top);
      }
    }
    const span = hi - lo || 1;
    lo -= span * 0.05;
    hi += span * 0.05;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const step = plotW / Math.max(n, 1);
    const yOf = (v: number) => PAD_T + ((hi - v) / (hi - lo)) * plotH;
    return {
      lo,
      hi,
      step,
      x: (i: number) => PAD_L + step * (i + 0.5),
      y: yOf,
      /** A price box as screen rows, clipped to the plot area; null when it is entirely outside. */
      box: (top: number, bottom: number): { top: number; bottom: number } | null => {
        const t = yOf(top);
        const b = yOf(bottom);
        const minY = PAD_T;
        const maxY = H - PAD_B;
        if (b < minY || t > maxY) return null;
        return { top: Math.max(minY, t), bottom: Math.min(maxY, b) };
      },
    };
  }, [candles, zones, absZones, fvgs, obs, n]);

  const ticks = useMemo(() => {
    // about five round price levels
    const rough = (geom.hi - geom.lo) / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
    const out: number[] = [];
    for (let v = Math.ceil(geom.lo / step) * step; v <= geom.hi; v += step) out.push(Number(v.toFixed(8)));
    return out;
  }, [geom]);

  const timeTicks = useMemo(() => {
    const out: Array<{ i: number; label: string }> = [];
    if (n < 2) return out;
    const every = Math.max(1, Math.floor(n / 6));
    const intraday = candles.length > 1 && Date.parse(candles[1].time) - Date.parse(candles[0].time) < 86_400_000;
    for (let i = every; i < n; i += every) {
      const iso = candles[i].time;
      out.push({ i, label: intraday ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10) });
    }
    return out;
  }, [candles, n]);

  const [hover, setHover] = useState<number | null>(null);

  const lastClose = candles[candles.length - 1]?.close;
  const firstTime = candles[0]?.time ? Date.parse(candles[0].time) : 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${chart.symbol} candles with AT24 indicator overlays`}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * W;
        const i = Math.round((x - PAD_L) / geom.step - 0.5);
        setHover(i >= 0 && i < n ? i : null);
      }}
      onMouseLeave={() => setHover(null)}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD_L} x2={W - PAD_R} y1={geom.y(t)} y2={geom.y(t)} stroke="currentColor" strokeOpacity={0.12} />
          <text x={W - PAD_R + 6} y={geom.y(t) + 4} fontSize={11} fill="currentColor" fillOpacity={0.6}>
            {fmtPrice(t)}
          </text>
        </g>
      ))}

      {timeTicks.map((t) => (
        <text key={t.i} x={geom.x(t.i)} y={H - 6} fontSize={10} fill="currentColor" fillOpacity={0.55} textAnchor="middle">
          {t.label}
        </text>
      ))}

      {zones.map((z, i) => {
        const startIdx = times.get(z.time);
        const x0 = startIdx === undefined ? (Date.parse(z.time) < firstTime ? PAD_L : null) : geom.x(startIdx);
        if (x0 === null) return null;
        const col = z.dir > 0 ? "#1D9E75" : "#D85A30";
        const box = geom.box(z.top, z.bottom);
        if (!box) return null;
        const { top, bottom } = box;
        return (
          <g key={`z${i}`}>
            <rect x={x0} y={top} width={W - PAD_R - x0} height={Math.max(2, bottom - top)} fill={col} fillOpacity={0.16} stroke={col} strokeOpacity={0.6} strokeWidth={1} />
            <text x={x0 + 4} y={top + 12} fontSize={11} fill={col}>
              {z.dir > 0 ? "demand" : "supply"}
            </text>
          </g>
        );
      })}

      {absZones.map((z, i) => {
        const startIdx = times.get(z.time);
        const x0 = startIdx === undefined ? (Date.parse(z.time) < firstTime ? PAD_L : null) : geom.x(startIdx);
        if (x0 === null) return null;
        const col = z.dir > 0 ? "#378ADD" : "#D4537E";
        const box = geom.box(z.top, z.bottom);
        if (!box) return null;
        const { top, bottom } = box;
        return (
          <g key={`a${i}`}>
            <rect x={x0} y={top} width={W - PAD_R - x0} height={Math.max(2, bottom - top)} fill={col} fillOpacity={0.14} stroke={col} strokeOpacity={0.7} strokeDasharray="4 2" />
            <text x={x0 + 4} y={top + 12} fontSize={11} fill={col}>
              {z.dir > 0 ? "sellers absorbed" : "buyers absorbed"}
            </text>
          </g>
        );
      })}

      {fvgs.map((g, i) => {
        const startIdx = times.get(g.time);
        const x0 = startIdx === undefined ? (Date.parse(g.time) < firstTime ? PAD_L : null) : geom.x(startIdx);
        if (x0 === null) return null;
        const col = g.dir > 0 ? "#0F6E56" : "#993C1D";
        const box = geom.box(g.top, g.bottom);
        if (!box) return null;
        const { top, bottom } = box;
        return (
          <g key={`f${i}`}>
            <rect x={x0} y={top} width={W - PAD_R - x0} height={Math.max(2, bottom - top)} fill={col} fillOpacity={0.1} stroke={col} strokeOpacity={0.5} strokeDasharray="2 3" />
            <text x={W - PAD_R - 4} y={top + 11} fontSize={10} fill={col} textAnchor="end">
              FVG
            </text>
          </g>
        );
      })}

      {obs.map((b, i) => {
        const startIdx = times.get(b.time);
        const x0 = startIdx === undefined ? (Date.parse(b.time) < firstTime ? PAD_L : null) : geom.x(startIdx);
        if (x0 === null) return null;
        const col = b.dir > 0 ? "#534AB7" : "#854F0B";
        const box = geom.box(b.top, b.bottom);
        if (!box) return null;
        const { top, bottom } = box;
        return (
          <g key={`o${i}`}>
            <rect x={x0} y={top} width={W - PAD_R - x0} height={Math.max(2, bottom - top)} fill="none" stroke={col} strokeOpacity={0.8} strokeWidth={1.5} />
            <text x={x0 + 4} y={bottom - 4} fontSize={10} fill={col}>
              {b.dir > 0 ? "bullish order block" : "bearish order block"}
            </text>
          </g>
        );
      })}

      {vp
        ? (
            [
              ["PD POC", vp.poc],
              ["PD VAH", vp.vah],
              ["PD VAL", vp.val],
            ] as Array<[string, number]>
          ).map(([label, v]) => (
            <g key={label}>
              <line x1={PAD_L} x2={W - PAD_R} y1={geom.y(v)} y2={geom.y(v)} stroke="#BA7517" strokeOpacity={0.8} strokeDasharray="6 3" />
              <text x={PAD_L + 4} y={geom.y(v) - 3} fontSize={10} fill="#BA7517">
                {label} {fmtPrice(v)}
              </text>
            </g>
          ))
        : null}

      {er
        ? ([
            ["expected high", er.expectedHigh, "#1D9E75"],
            ["expected low", er.expectedLow, "#E24B4A"],
            ["day open", er.open, "#888780"],
          ] as Array<[string, number, string]>).map(([label, v, col]) => {
            const startIdx = times.get(er.dayStart);
            const x0 = startIdx === undefined ? PAD_L : geom.x(startIdx);
            return (
              <g key={label}>
                <line x1={x0} x2={W - PAD_R} y1={geom.y(v)} y2={geom.y(v)} stroke={col} strokeWidth={1.5} strokeOpacity={0.85} />
                <text x={W - PAD_R - 4} y={geom.y(v) - 3} fontSize={10} fill={col} textAnchor="end">
                  {label} {fmtPrice(v)}
                </text>
              </g>
            );
          })
        : null}

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

      {setups
        ? setups.recent.map((t, i) => {
            const a = times.get(t.entryTime);
            if (a === undefined) return null;
            const b = t.exitTime ? times.get(t.exitTime) ?? n - 1 : n - 1;
            const col = t.result === 1 ? "#1D9E75" : t.result === -1 ? "#E24B4A" : t.result === 0 ? "#BA7517" : "#888780";
            return (
              <g key={`s${i}`}>
                <line x1={geom.x(a)} x2={geom.x(b)} y1={geom.y(t.entry)} y2={geom.y(t.entry)} stroke={col} strokeWidth={2} strokeDasharray="2 3" />
                <text x={geom.x(a)} y={geom.y(t.entry) + (t.dir > 0 ? 12 : -4)} fontSize={10} fill={col}>
                  {t.type === "pullback" ? "pullback" : "squeeze"} {t.dir > 0 ? "long" : "short"}
                </text>
              </g>
            );
          })
        : null}

      {setups?.live ? (
        <g>
          {(
            [
              ["entry", setups.live.entry, "currentColor"],
              ["stop", setups.live.stop, "#E24B4A"],
              ["target", setups.live.target, "#1D9E75"],
            ] as Array<[string, number, string]>
          ).map(([label, v, col]) => (
            <g key={label}>
              <line x1={geom.x(n - 1)} x2={W - PAD_R} y1={geom.y(v)} y2={geom.y(v)} stroke={col} strokeWidth={1.5} strokeDasharray="5 3" />
              <text x={W - PAD_R - 4} y={geom.y(v) - 3} fontSize={10} fill={col} textAnchor="end">
                setup {label} {fmtPrice(v)}
              </text>
            </g>
          ))}
        </g>
      ) : null}

      {structure.map((e, i) => {
        const a = times.get(e.pivotTime);
        const b = times.get(e.breakTime);
        if (b === undefined) return null;
        const x0 = a === undefined ? PAD_L : geom.x(a);
        const col = e.kind === "CHoCH" ? "#BA7517" : "#185FA5";
        return (
          <g key={`m${i}`}>
            <line x1={x0} x2={geom.x(b)} y1={geom.y(e.price)} y2={geom.y(e.price)} stroke={col} strokeWidth={1.5} strokeDasharray={e.kind === "CHoCH" ? "5 3" : undefined} />
            <text x={(x0 + geom.x(b)) / 2} y={geom.y(e.price) + (e.dir > 0 ? -4 : 11)} fontSize={10} fill={col} textAnchor="middle">
              {e.kind} {e.dir > 0 ? "up" : "down"}
            </text>
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
      {hover !== null && candles[hover] ? (
        <g pointerEvents="none">
          <line x1={geom.x(hover)} x2={geom.x(hover)} y1={PAD_T} y2={H - PAD_B} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" />
          <rect x={PAD_L + 2} y={PAD_T + 2} width={430} height={18} rx={3} fill="currentColor" fillOpacity={0.12} />
          <text x={PAD_L + 8} y={PAD_T + 15} fontSize={11} fill="currentColor">
            {candles[hover].time.slice(0, 16).replace("T", " ")} · O {fmtPrice(candles[hover].open)} · H {fmtPrice(candles[hover].high)} · L {fmtPrice(candles[hover].low)} · C {fmtPrice(candles[hover].close)}
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

function IndCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <p className="font-medium">{title}</p>
      {note ? <p className="mb-1 mt-0.5 text-xs text-text-3">{note}</p> : null}
      {children}
    </div>
  );
}

function StatLine({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-1.5 text-xs first:border-t-0">
      <span className="text-text-2">{label}</span>
      <span className="text-right">
        <span className="font-medium">{value}</span>
        {extra ? <span className="ml-1 text-text-3">{extra}</span> : null}
      </span>
    </div>
  );
}

const SHIFT_TEXT = { normal: "Normal", shifted_up: "Shifted up", shifted_down: "Shifted down", extreme: "At an extreme" } as const;

export default function MarketBoardPage() {
  const [symbol, setSymbol] = useState("XAUUSD");
  const [interval, setIntervalId] = useState<BoardTimeframe>("15m");
  const [on, setOn] = useState<OnMap>({ zones: true, divergence: true, absorption: false, setups: false, fvg: false, ob: false, vp: false, structure: false, expected: false });
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
        description="AT24 indicators on a live chart, each with how it did on that chart's own history, plus a market heatmap and correlation shifts. Descriptive context, not a signal."
      />

      <Alert tone="info" title="How to read it" className="mb-6">
        Zones, divergences and setups are known only after their bars have closed (nothing repaints). The scorecards show how each past zone retest, divergence or setup would have turned out
        in R after cost; the statistics cards compare gaps, order blocks and volume levels with a control. A verdict says positive or negative only when the result is beyond luck; otherwise it says no
        edge shown. Past results do not predict future results. Not financial advice.
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
            {inst?.label} · bid · updates every 10 s{data ? ` · ${data.source === "exness" ? "Exness API" : "AT24 data bridge"}` : ""}
          </span>
        </div>

        {chart.status === "error" ? (
          <ErrorState title="Chart unavailable" description={chart.message} action={<Button variant="secondary" onClick={() => void loadChart()}>Try again</Button>} />
        ) : chart.status === "loading" ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="self-start rounded-md border border-border bg-surface-1 p-2 text-text">
                <ChartSvg chart={chart.data} on={on} />
              </div>
              <div className="self-start rounded-md border border-border p-3 text-sm">
                <p className="mb-2 font-medium">Indicators on chart</p>
                {INDICATORS.map((ind) => (
                  <label key={ind.key} className="flex cursor-pointer items-center justify-between py-1">
                    <span>{ind.label}</span>
                    <input type="checkbox" checked={on[ind.key]} onChange={(e) => setOn((prev) => ({ ...prev, [ind.key]: e.target.checked }))} />
                  </label>
                ))}
                {chart.data.volumeProfile === null ? <p className="mt-2 text-xs text-text-3">Volume Profile Levels needs an M15 or H1 chart.</p> : null}
                <p className="mt-2 text-xs text-text-3">More indicators are in the AT24 marketplace for MetaTrader 5, MetaTrader 4 and TradingView.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {on.zones ? (
                <IndCard title="Zone Pro" note={`First retest of past zones on this chart (${chart.data.barsAnalysed} bars, cost ${chart.data.costUsed.toFixed(chart.data.costUsed < 1 ? 4 : 2)})`}>
                  <ScoreLine label="Demand" score={chart.data.zones.scores.demand} unit="retests" />
                  <ScoreLine label="Supply" score={chart.data.zones.scores.supply} unit="retests" />
                  <ScoreLine label="All zones" score={chart.data.zones.scores.all} unit="retests" />
                  <div className="mt-2 border-t border-border pt-2 text-xs">
                    <p className="mb-1 font-medium">Plan for the nearest fresh zone</p>
                    {(["supply", "demand"] as const).map((side) => {
                      const z = nearest[side];
                      return (
                        <p key={side} className="py-0.5">
                          <span className={side === "demand" ? "text-success" : "text-danger"}>{side === "demand" ? "Demand below" : "Supply above"}:</span>{" "}
                          {z ? `${z.plan.side} limit ${fmtPrice(z.plan.limit)}, stop ${fmtPrice(z.plan.stop)}, target ${fmtPrice(z.plan.target)}` : "none fresh"}
                        </p>
                      );
                    })}
                    <p className="mt-1 text-text-3">{chart.data.zones.touchedOnLastBar ? "A zone was touched on the last closed bar." : "No zone touched on the last closed bar."}</p>
                  </div>
                </IndCard>
              ) : null}

              {on.divergence ? (
                <IndCard
                  title="Divergence Pro"
                  note={
                    chart.data.divergences.live
                      ? "plan" in chart.data.divergences.live && chart.data.divergences.live.plan === null
                        ? `A ${chart.data.divergences.live.dir > 0 ? "bullish" : "bearish"} divergence was confirmed on the last closed bar (no plan: stop too far).`
                        : `A ${chart.data.divergences.live.dir > 0 ? "bullish" : "bearish"} divergence was confirmed on the last closed bar.`
                      : "No divergence on the last closed bar."
                  }
                >
                  <ScoreLine label="Bullish" score={chart.data.divergences.scores.bullish} unit="trades" />
                  <ScoreLine label="Bearish" score={chart.data.divergences.scores.bearish} unit="trades" />
                  <ScoreLine label="All" score={chart.data.divergences.scores.all} unit="trades" />
                </IndCard>
              ) : null}

              {on.absorption ? (
                <IndCard title="Absorption Map" note="Heavy tick volume with a small range after a push; first retest of past zones. Tick volume per bar, not true order flow.">
                  <ScoreLine label="Sellers absorbed" score={chart.data.absorption.scores.sellers} unit="retests" />
                  <ScoreLine label="Buyers absorbed" score={chart.data.absorption.scores.buyers} unit="retests" />
                  <ScoreLine label="All zones" score={chart.data.absorption.scores.all} unit="retests" />
                  <p className="mt-1 text-xs text-text-3">{chart.data.absorption.touchedOnLastBar ? "A zone was touched on the last closed bar." : "No zone touched on the last closed bar."}</p>
                </IndCard>
              ) : null}

              {on.setups ? (
                <IndCard
                  title="Setup Pro"
                  note={
                    chart.data.setups.live
                      ? `A ${chart.data.setups.live.type} setup (${chart.data.setups.live.dir > 0 ? "long" : "short"}) formed on the last closed bar: entry about ${fmtPrice(chart.data.setups.live.entry)}, stop ${fmtPrice(chart.data.setups.live.stop)}, target ${fmtPrice(chart.data.setups.live.target)}.`
                      : "No setup on the last closed bar."
                  }
                >
                  <ScoreLine label="Trend pullback" score={chart.data.setups.scores.pullback} unit="setups" />
                  <ScoreLine label="Squeeze release" score={chart.data.setups.scores.squeeze} unit="setups" />
                </IndCard>
              ) : null}

              {on.fvg ? (
                <IndCard title="FVG Zones" note="Three-bar gaps: how often price came back and what it did, against a control level.">
                  {chart.data.fvg.stats ? (
                    <>
                      <StatLine label="Gaps measured" value={String(chart.data.fvg.stats.measured)} />
                      <StatLine label="Touched within 50 bars" value={`${chart.data.fvg.stats.touchedPct.toFixed(1)}%`} extra={`control ${chart.data.fvg.stats.controlPct.toFixed(1)}%`} />
                      <StatLine label="Filled within 50 bars" value={`${chart.data.fvg.stats.filledPct.toFixed(1)}%`} />
                      <StatLine label="Median wait to the touch" value={`${chart.data.fvg.stats.medianWaitBars.toFixed(0)} bars`} />
                      <StatLine label="Moved away after the touch" value={`${chart.data.fvg.stats.reactedPct.toFixed(1)}%`} extra={`of ${chart.data.fvg.stats.touchedN} touches`} />
                    </>
                  ) : (
                    <p className="text-xs text-text-3">Not enough gaps on this chart yet.</p>
                  )}
                </IndCard>
              ) : null}

              {on.ob ? (
                <IndCard title="Order Block Lab" note="The last opposite candle before a strong move: how often price came back and reacted, against a mirrored control level.">
                  {chart.data.orderBlocks.stats ? (
                    <>
                      <StatLine label="Blocks measured" value={String(chart.data.orderBlocks.stats.measured)} />
                      <StatLine label="Revisited within 100 bars" value={`${chart.data.orderBlocks.stats.touchedPct.toFixed(1)}%`} extra={`control ${chart.data.orderBlocks.stats.controlTouchedPct.toFixed(1)}%`} />
                      <StatLine label="Moved away after the revisit" value={`${chart.data.orderBlocks.stats.reactedPct.toFixed(1)}%`} extra={`control ${chart.data.orderBlocks.stats.controlReactedPct.toFixed(1)}%`} />
                      <StatLine label="Decided revisits" value={String(chart.data.orderBlocks.stats.decided)} extra={`control ${chart.data.orderBlocks.stats.controlDecided}`} />
                    </>
                  ) : (
                    <p className="text-xs text-text-3">Not enough blocks on this chart yet.</p>
                  )}
                </IndCard>
              ) : null}

              {on.structure ? (
                <IndCard title="Market Structure" note={`Swing breaks: BOS with the trend, CHoCH against it. Current trend: ${chart.data.structure.trend === "none" ? "not set yet" : chart.data.structure.trend}.`}>
                  {chart.data.structure.stats ? (
                    <>
                      <StatLine label="Breaks of structure (BOS)" value={String(chart.data.structure.stats.bos)} extra={`price continued ${chart.data.structure.stats.bosFollowPct.toFixed(0)}% of ${chart.data.structure.stats.bosN}`} />
                      <StatLine label="Change of character (CHoCH)" value={String(chart.data.structure.stats.choch)} extra={`price continued ${chart.data.structure.stats.chochFollowPct.toFixed(0)}% of ${chart.data.structure.stats.chochN}`} />
                      <StatLine label="Base rate: price higher 20 bars later" value={`${chart.data.structure.stats.baseUpPct.toFixed(0)}%`} />
                    </>
                  ) : (
                    <p className="text-xs text-text-3">Not enough swing breaks on this chart yet.</p>
                  )}
                </IndCard>
              ) : null}

              {on.expected ? (
                <IndCard title="Expected Range" note="The usual daily range (average of the last 14 days), how much of it is used today, and the projected day high and low.">
                  {chart.data.expectedRange?.today ? (
                    <p className="mb-1 text-xs">
                      Usual range {fmtPrice(chart.data.expectedRange.today.usual)} · used so far {chart.data.expectedRange.today.usedPct.toFixed(0)}% · projected high {fmtPrice(chart.data.expectedRange.today.expectedHigh)} · projected low {fmtPrice(chart.data.expectedRange.today.expectedLow)}
                    </p>
                  ) : (
                    <p className="text-xs text-text-3">{chart.data.expectedRange ? "Needs 14 days of history." : "Needs an intraday chart (M15, H1 or H4)."}</p>
                  )}
                  {chart.data.expectedRange?.stats ? (
                    <>
                      <StatLine label="Days measured" value={String(chart.data.expectedRange.stats.days)} extra={`median range ${chart.data.expectedRange.stats.medianRatio.toFixed(2)}x usual`} />
                      <StatLine label="Reached the usual range" value={`${chart.data.expectedRange.stats.reach100Pct.toFixed(0)}%`} extra={`1.5x or more: ${chart.data.expectedRange.stats.reach150Pct.toFixed(0)}%`} />
                      <StatLine label="Net move of at least half the usual range" value={`${chart.data.expectedRange.stats.directional50Pct.toFixed(0)}%`} />
                    </>
                  ) : null}
                </IndCard>
              ) : null}

              {on.vp ? (
                <IndCard title="Volume Profile Levels" note="The previous day's point of control and value area, and how they behaved the next day.">
                  {chart.data.volumeProfile?.levels ? (
                    <p className="mb-1 text-xs">
                      PD POC {fmtPrice(chart.data.volumeProfile.levels.poc)} · PD VAH {fmtPrice(chart.data.volumeProfile.levels.vah)} · PD VAL {fmtPrice(chart.data.volumeProfile.levels.val)}
                    </p>
                  ) : (
                    <p className="text-xs text-text-3">{chart.data.volumeProfile ? "No completed day with a profile yet." : "Needs an M15 or H1 chart."}</p>
                  )}
                  {chart.data.volumeProfile?.study
                    ? chart.data.volumeProfile.study.map((r) => (
                        <StatLine key={r.name} label={`${r.name}: touched next day`} value={`${r.touchPct.toFixed(0)}%`} extra={`control ${r.controlTouchPct.toFixed(0)}%, moved away ${r.reactedPct.toFixed(0)}% (control ${r.controlReactedPct.toFixed(0)}%) of ${r.decided}`} />
                      ))
                    : null}
                </IndCard>
              ) : null}
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
