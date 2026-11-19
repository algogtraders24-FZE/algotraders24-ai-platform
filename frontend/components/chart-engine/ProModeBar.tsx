"use client";
// components/chart-engine/ProModeBar.tsx
// Professional Mode controls for the native chart: one-click "Analyze chart", a Layers popup (per-group toggles +
// "Clean chart"), and the expandable "Annotations detected" list. State lives in NativeChart; this is presentational.
import { useState } from "react";
import type { TradePlan } from "@/lib/chart-engine/annotations/plan";
import { ANNOTATION_GROUPS, ANNOTATION_GROUP_LABELS, type AnnotationLayers, type AnnotationResult } from "@/lib/chart-engine/annotations/types";

interface Props {
  analysis: AnnotationResult | null;
  layers: AnnotationLayers;
  onAnalyze: () => void;
  onToggleLayer: (group: keyof AnnotationLayers) => void;
  onCleanChart: () => void;
  onShowAll: () => void;
}

const BTN = "rounded-control border border-border bg-ink-3 px-2.5 py-1 text-xs text-text-2 transition hover:border-gold/50 hover:text-text";

export function ProModeBar({ analysis, layers, onAnalyze, onToggleLayer, onCleanChart, onShowAll }: Props) {
  const [layersOpen, setLayersOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const c = analysis?.counts;

  return (
    <div className="relative flex flex-wrap items-center gap-2 text-xs">
      <button type="button" onClick={onAnalyze} className="rounded-control border border-gold/50 bg-gold/10 px-3 py-1 text-xs font-medium text-gold transition hover:bg-gold/20">
        Analyze chart
      </button>
      <button type="button" onClick={() => setLayersOpen((v) => !v)} className={BTN} aria-expanded={layersOpen}>
        Layers
      </button>
      <button type="button" onClick={onCleanChart} className={BTN}>
        Clean chart
      </button>
      {c && (
        <button type="button" onClick={() => setListOpen((v) => !v)} className={BTN} aria-expanded={listOpen}>
          {c.total} annotations detected {listOpen ? "▴" : "▾"}
        </button>
      )}

      {layersOpen && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-panel border border-border bg-ink-2 p-3 shadow-lg">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-text-3">Analysis layers</p>
          {ANNOTATION_GROUPS.map((g) => (
            <label key={g} className="flex cursor-pointer items-center gap-2 py-1 text-xs text-text-2">
              <input type="checkbox" checked={layers[g]} onChange={() => onToggleLayer(g)} />
              {ANNOTATION_GROUP_LABELS[g]}
            </label>
          ))}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onShowAll} className={BTN}>Show all</button>
            <button type="button" onClick={onCleanChart} className={BTN}>Clean chart</button>
          </div>
        </div>
      )}

      {listOpen && c && analysis && (
        <div className="w-full rounded-panel border border-border bg-ink-2 p-3 text-xs text-text-2">
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            <li>Structure lines (BOS / CHoCH): {c.lines}</li>
            <li>Zones (OB / FVG / P-D / OTE): {c.zones}</li>
            <li>Sweeps: {c.markers}</li>
            <li>S/R levels: {c.levels}</li>
            <li>Patterns: {c.patterns}</li>
            <li>Session markers: {c.sessions}</li>
          </ul>
          <p className="mt-2 text-[11px] text-text-3">
            Rule set: swing size {analysis.params.swingBars} bars, ATR(14) {analysis.params.atr.toPrecision(5)}. These are descriptive structure maps of what price already did; they are not a prediction.
          </p>
        </div>
      )}
    </div>
  );
}

interface PlanOverlayProps {
  plan: TradePlan | null;
  onExecute: (side: "buy" | "sell") => void;
  onClose: () => void;
  formatPrice: (n: number) => string;
}

/** Floating trade card in the top-left of the chart (Pipflow-style): compact, details on demand. */
export function PlanOverlay({ plan, onExecute, onClose, formatPrice }: PlanOverlayProps) {
  const [open, setOpen] = useState(false);
  if (!plan) return null;
  const shell = "absolute left-3 top-3 z-10 w-64 rounded-panel border border-border bg-ink-2/95 p-3 text-xs text-text-2 shadow-lg backdrop-blur";
  const close = (
    <button type="button" onClick={onClose} aria-label="Close plan" className="text-text-3 hover:text-text">×</button>
  );
  if (plan.state === "standAside") {
    return (
      <div className={shell}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Stand aside</span>
          {close}
        </div>
        <p className="mt-1.5 leading-snug">{plan.reason}</p>
      </div>
    );
  }
  const long = plan.dir === "long";
  const row = (label: string, value: number, cls: string) => (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-text-3">{label}</span>
      <span className={`font-mono text-[13px] font-medium ${cls}`}>{formatPrice(value)}</span>
    </div>
  );
  return (
    <div className={shell}>
      <div className="flex items-center justify-between">
        <span className={`rounded-control px-2 py-0.5 text-[11px] font-semibold uppercase ${long ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>{plan.dir}</span>
        <span className="text-[11px] text-text-3">Score {plan.score}/{plan.scoreMax} · R:R 1:{plan.rr}</span>
        {close}
      </div>
      <div className="mt-2 border-t border-border pt-1.5">
        {row("ENTRY", plan.entry, "text-text")}
        {row("STOP", plan.stop, "text-red-400")}
        {row("TARGET", plan.target, "text-green-400")}
      </div>
      <button
        type="button"
        onClick={() => onExecute(long ? "buy" : "sell")}
        className={`mt-2 w-full rounded-control py-1.5 text-xs font-semibold ${long ? "bg-green-500/20 text-green-300 hover:bg-green-500/30" : "bg-red-500/20 text-red-300 hover:bg-red-500/30"}`}
      >
        Execute (paper)
      </button>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-2 w-full text-left text-[11px] text-text-3 hover:text-text">
        Evidence {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 text-[11px] leading-snug text-text-3">
          <p>{plan.source}. Confluences: {plan.confluences.join(", ") || "none"}. Score counts rules that agree; it is not a probability.</p>
          <p>
            {plan.record
              ? `Same rule replayed on this chart's ${plan.record.bars} loaded candles: ${plan.record.n} trades, average ${plan.record.avgR >= 0 ? "+" : ""}${plan.record.avgR.toFixed(2)} R, target first in ${(plan.record.targetShare * 100).toFixed(0)} % (before spread and commission; past results do not predict future ones).`
              : "Too little history on this chart to measure this rule, so no record is shown rather than an invented one."}
          </p>
          <p>Execute opens the paper ticket for you to confirm; set the stop and target shown. Educational, not financial advice.</p>
        </div>
      )}
    </div>
  );
}
