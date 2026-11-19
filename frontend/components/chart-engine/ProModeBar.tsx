"use client";
// components/chart-engine/ProModeBar.tsx
// Professional Mode controls for the native chart: one-click "Analyze chart", a Layers popup (per-group toggles +
// "Clean chart"), and the expandable "Annotations detected" list. State lives in NativeChart; this is presentational.
import { useState } from "react";
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
