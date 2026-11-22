"use client";
// components/chart-engine/ScanOverlay.tsx
// The "Analyze" reveal on the Pro Chart: ONE glowing beam sweeps the chart left to right and draws the layered curves (price, upper and lower
// envelope, trend) together, with a glowing head, "ANALYSING nn %" and a progress track at the bottom. After the sweep the curves stay and a soft
// pulse waits for the analysis (PRAGYA) - at least `minMs`, at most `maxMs` - then an "Analysis complete" toast. Gold = the AT24 accent.
import { useEffect, useRef, useState } from "react";

interface Props {
  active: boolean;
  /** Layered curves in chart pixels (x ascending); sweep n draws curve n. */
  curves: [number, number][][];
  width: number;
  height: number;
  /** The analysis is ready: the scan may finish once minMs has passed. */
  ready: boolean;
  minMs?: number;
  maxMs?: number;
  passMs?: number;
  onDone: () => void;
}

const GOLD = "212,175,55";
const BRIGHT = "240,205,90";

export default function ScanOverlay({ active, curves, width, height, ready, minMs = 2800, maxMs = 12000, passMs = 2300, onDone }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    if (!active) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      const finished = reduced ? t >= 300 : (t >= minMs && readyRef.current) || t >= maxMs;
      setElapsed(t);
      if (!finished) raf = requestAnimationFrame(tick);
      else {
        setElapsed(0);
        setToast(true);
        doneRef.current();
      }
    };
    setElapsed(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, minMs, maxMs]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const sweeping = elapsed < passMs;
  const x = Math.min(1, elapsed / passMs) * width;
  const toPath = (pts: [number, number][], upTo: number) =>
    pts.filter((p) => p[0] <= upTo).map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const headPts = (curves[0] ?? []).filter((p) => p[0] <= x);
  const head = sweeping ? headPts[headPts.length - 1] : undefined;
  const pct = String(Math.min(99, Math.round((elapsed / passMs) * 100))).padStart(3, "0");

  return (
    <>
      {active && (
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
          {sweeping && <div className="absolute top-0 h-full" style={{ left: x - 70, width: 140, background: `linear-gradient(90deg, rgba(${GOLD},0) 0%, rgba(${GOLD},0.28) 50%, rgba(${GOLD},0) 100%)` }} />}
          {sweeping && <div className="absolute top-0 h-full" style={{ left: x - 1, width: 2, background: `rgba(${BRIGHT},0.95)`, boxShadow: `0 0 18px 4px rgba(${GOLD},0.75)` }} />}
          <svg width={width} height={height} className="absolute left-0 top-0">
            {curves.map((pts, k) => {
              const d = toPath(pts, x);
              return (
                <g key={k}>
                  <path d={d} fill="none" stroke={`rgba(${GOLD},0.28)`} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
                  <path d={d} fill="none" stroke={`rgba(${BRIGHT},${k === 0 ? 0.95 : 0.75})`} strokeWidth={k === 0 ? 2.2 : 1.6} strokeLinecap="round" strokeLinejoin="round" />
                </g>
              );
            })}
            {head && (
              <>
                <circle cx={head[0]} cy={head[1]} r={15} fill={`rgba(${GOLD},0.22)`} />
                <circle cx={head[0]} cy={head[1]} r={7} fill="#fff4cf" style={{ filter: `drop-shadow(0 0 9px rgba(${BRIGHT},1))` }} />
              </>
            )}
          </svg>
          <div className="absolute bottom-2 right-3 font-mono text-[11px] tracking-wider" style={{ color: `rgb(${BRIGHT})` }}>
            {sweeping ? `ANALYSING: ${pct}%` : <span className="animate-pulse">ANALYSING…</span>}
          </div>
          <div className="absolute bottom-0 left-0 w-full" style={{ height: 3, backgroundImage: `repeating-linear-gradient(90deg, rgba(${GOLD},0.35) 0 3px, transparent 3px 8px)` }} />
          <div className="absolute bottom-0 left-0 h-[3px]" style={{ width: x, background: `linear-gradient(90deg, rgba(${GOLD},0), rgba(${BRIGHT},1))`, boxShadow: `0 0 10px rgba(${GOLD},0.9)` }} />
          {sweeping && <div className="absolute rounded-full" style={{ left: x - 4, bottom: -2, width: 8, height: 8, background: "#fff4cf", boxShadow: `0 0 10px 2px rgba(${BRIGHT},0.95)` }} />}
        </div>
      )}
      {toast && (
        <div role="status" className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-panel border border-gold/40 bg-ink-2/90 px-4 py-2 text-xs font-medium text-gold shadow-lg backdrop-blur">
          ✓ Analysis complete
        </div>
      )}
    </>
  );
}
