"use client";
// components/quant-lite/EquityCurveChart.tsx
// Sprint Q0.8 - lightweight, dependency-free SVG line chart. This app has
// no charting library dependency (confirmed: no recharts/visx/d3/
// chart.js in package.json) and its existing Native Chart Engine
// (components/chart-engine/) is a large, purpose-built candlestick/
// live-market system - reusing it for a simple equity curve would be
// disproportionate and risk touching shared chart-engine code
// unnecessarily. This component plots real trade-close balance points
// only (Q0.7 Part 6: the engine returns an equity Series; this build
// derives the same real curve from the real per-trade `balanceAfter`
// values already in the trade ledger) - no interpolation, no synthetic
// smoothing, no fabricated points.
import { useMemo, useState } from "react";
import { FIN_TERTIARY } from "@/components/ui/financial-typography";
import type { Trade } from "@/types/quant-lite";

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

export default function EquityCurveChart({ trades, startBalance }: { trades: Trade[]; startBalance: number }) {
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo(() => {
    const series = [{ x: 0, y: startBalance, label: "Start", time: null as string | null }];
    trades.forEach((t, i) => {
      series.push({ x: i + 1, y: t.balanceAfter, label: `Trade ${t.tradeNumber}`, time: t.exitTime });
    });
    return series;
  }, [trades, startBalance]);

  if (points.length < 2) {
    return <p className="text-sm text-text-3">Not available - no closed trades to plot.</p>;
  }

  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const yRange = maxY - minY || 1;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const toX = (x: number) => PAD.left + (x / (points.length - 1)) * plotW;
  const toY = (y: number) => PAD.top + (1 - (y - minY) / yRange) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.x).toFixed(1)} ${toY(p.y).toFixed(1)}`).join(" ");
  const peak = points.reduce((max, p) => Math.max(max, p.y), points[0].y);
  const active = hover !== null ? points[hover] : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Equity curve from ${startBalance} starting balance to ${points[points.length - 1].y.toFixed(2)} final balance across ${trades.length} trades`}
      >
        <line x1={PAD.left} y1={toY(startBalance)} x2={WIDTH - PAD.right} y2={toY(startBalance)} stroke="var(--border)" strokeDasharray="4 4" />
        <path d={path} fill="none" stroke="var(--gold)" strokeWidth={2} />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={toX(p.x)}
            cy={toY(p.y)}
            r={i === hover ? 4 : 2.5}
            fill={p.y >= startBalance ? "var(--signal-up)" : "var(--signal-down)"}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <text x={PAD.left} y={HEIGHT - 6} className="fill-current text-text-3" fontSize={10}>
          {minY.toFixed(0)}
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-current text-text-3" fontSize={10}>
          {maxY.toFixed(0)}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={FIN_TERTIARY}>
          Start ${startBalance.toLocaleString()} - Peak ${peak.toLocaleString(undefined, { maximumFractionDigits: 0 })} - Final $
          {points[points.length - 1].y.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
        {active && (
          <span className="rounded-control border border-border bg-ink-2 px-2 py-1 text-text-2">
            {active.label}
            {active.time ? ` - ${new Date(active.time).toLocaleString()}` : ""} - ${active.y.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        )}
      </div>
    </div>
  );
}
