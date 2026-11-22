"use client";
// components/chart-engine/ScanOverlay.tsx
// The "Analyze" reveal on the Pro Chart (modelled on what a pro charting assistant does): a glowing scan line sweeps the chart left to right,
// a smooth price wave is drawn behind it with a bright head, "SCANNING nn %" and a progress line show at the bottom, then an
// "Analysis complete" toast. The analysis itself is instant (computed locally from the loaded candles); this is the reveal animation.
import { useEffect, useRef, useState } from "react";

interface Props {
  active: boolean;
  /** Smooth price wave in chart pixels (x ascending). */
  points: [number, number][];
  width: number;
  height: number;
  durationMs?: number;
  onDone: () => void;
}

export default function ScanOverlay({ active, points, width, height, durationMs = 2200, onDone }: Props) {
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!active) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const total = reduced ? 300 : durationMs;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / total);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else {
        setProgress(0);
        setToast(true);
        doneRef.current();
      }
    };
    setProgress(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, durationMs]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const x = progress * width;
  const shown = points.filter((p) => p[0] <= x);
  const head = shown[shown.length - 1];
  const path = shown.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const pct = String(Math.round(progress * 100)).padStart(3, "0");

  return (
    <>
      {active && (
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
          <div
            className="absolute top-0 h-full"
            style={{ left: x - 40, width: 80, background: "linear-gradient(90deg, rgba(212,175,55,0) 0%, rgba(212,175,55,0.22) 50%, rgba(212,175,55,0) 100%)" }}
          />
          <div className="absolute top-0 h-full w-px" style={{ left: x, background: "rgba(240,205,90,0.9)", boxShadow: "0 0 12px 2px rgba(212,175,55,0.7)" }} />
          <svg width={width} height={height} className="absolute left-0 top-0">
            <path d={path} fill="none" stroke="rgba(212,175,55,0.35)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
            <path d={path} fill="none" stroke="rgba(240,205,90,0.95)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {head && <circle cx={head[0]} cy={head[1]} r={5} fill="#fff4cf" style={{ filter: "drop-shadow(0 0 6px rgba(240,205,90,1))" }} />}
          </svg>
          <div className="absolute bottom-2 right-3 font-mono text-[11px] tracking-wider" style={{ color: "rgb(230,195,90)" }}>
            SCANNING: {pct}%
          </div>
          <div className="absolute bottom-0 left-0 h-[3px]" style={{ width: x, background: "linear-gradient(90deg, rgba(212,175,55,0), rgba(240,205,90,1))", boxShadow: "0 0 8px rgba(212,175,55,0.8)" }} />
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
