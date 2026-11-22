"use client";
// components/chart-engine/ProModeBar.tsx
// Professional Mode controls for the native chart: one-click "Analyze chart", a Layers popup (per-group toggles +
// "Clean chart"), and the expandable "Annotations detected" list. State lives in NativeChart; this is presentational.
import { useState } from "react";
import type { TradePlan } from "@/lib/chart-engine/annotations/plan";
import { ANNOTATION_GROUPS, ANNOTATION_GROUP_LABELS, type AnnotationLayers, type AnnotationResult, type ChartLayers } from "@/lib/chart-engine/annotations/types";

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
  /** Pro layout: render in the side panel instead of floating over the chart. */
  inline?: boolean;
}

/** Floating trade card in the top-left of the chart (Pipflow-style): compact, details on demand. */
export function PlanOverlay({ plan, onExecute, onClose, formatPrice, inline }: PlanOverlayProps) {
  const [open, setOpen] = useState(false);
  if (!plan) return null;
  const shell = (inline ? "w-full " : "absolute left-3 top-3 z-10 w-64 ") + "rounded-panel border border-border bg-ink-2/95 p-3 text-[14px] text-text-2 shadow-lg backdrop-blur";
  const close = (
    <button type="button" onClick={onClose} aria-label="Close plan" className="text-text-3 hover:text-text">×</button>
  );
  if (plan.state === "standAside") {
    return (
      <div className={shell}>
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-semibold uppercase tracking-wide text-text-3">No clean setup, stand aside</span>
          {close}
        </div>
        <p className="mt-1.5 leading-snug">{plan.reason} See the analysis below.</p>
      </div>
    );
  }
  const long = plan.dir === "long";
  const tint = long ? "border-green-500/40 bg-gradient-to-b from-green-500/15 to-ink-2" : "border-red-500/40 bg-gradient-to-b from-red-500/15 to-ink-2";
  const row = (label: string, value: number, cls: string) => (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-text-3">{label}</span>
      <span className={`text-[15px] font-semibold tabular-nums ${cls}`}>{formatPrice(value)}</span>
    </div>
  );
  return (
    <div className={shell.replace("border-border bg-ink-2/95", tint)}>
      <div className="flex items-center justify-between">
        <span className={`rounded-control px-2 py-0.5 text-[12.5px] font-semibold uppercase ${long ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>{plan.dir}</span>
        <span className="text-[12.5px] text-text-3">Score {plan.score}/{plan.scoreMax} · R:R 1:{plan.rr}</span>
        {close}
      </div>
      <div className="mt-2 border-t border-border pt-1.5">
        {row(plan.entryType === "limit" ? "ENTRY (limit)" : "ENTRY (market)", plan.entry, "text-text")}
        {row("STOP", plan.stop, "text-red-400")}
        {row("TARGET", plan.target, "text-green-400")}
      </div>
      <button
        type="button"
        onClick={() => onExecute(long ? "buy" : "sell")}
        className={`mt-2 w-full rounded-control py-1.5 text-[14px] font-semibold ${long ? "bg-green-500/20 text-green-300 hover:bg-green-500/30" : "bg-red-500/20 text-red-300 hover:bg-red-500/30"}`}
      >
        {plan.entryType === "limit" ? (long ? "Place Long limit" : "Place Short limit") : (long ? "Execute Long" : "Execute Short")}
      </button>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-2 w-full text-left text-[12.5px] text-text-3 hover:text-text">
        Evidence {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 text-[12.5px] leading-snug text-text-3">
          <p>{plan.source}. Confluences: {plan.confluences.join(", ") || "none"}. Score counts rules that agree; it is not a probability.</p>
          <p>
            {plan.record
              ? `Same rule replayed on this chart's ${plan.record.bars} loaded candles: ${plan.record.n} trades, average ${plan.record.avgR >= 0 ? "+" : ""}${plan.record.avgR.toFixed(2)} R (±${plan.record.se.toFixed(2)}), target first in ${(plan.record.targetShare * 100).toFixed(0)} % (before spread and commission; past results do not predict future ones).`
              : "Too little history on this chart to measure this rule, so no record is shown rather than an invented one."}
          </p>
          <p>
            {plan.record && plan.record.baselineAvgR !== undefined
              ? `Luck check: the same rule on shuffled copies of this chart scores ${plan.record.baselineAvgR >= 0 ? "+" : ""}${plan.record.baselineAvgR.toFixed(2)} R, so the edge over luck is ${(plan.record.avgR - plan.record.baselineAvgR) >= 0 ? "+" : ""}${(plan.record.avgR - plan.record.baselineAvgR).toFixed(2)} R${Math.abs(plan.record.avgR - plan.record.baselineAvgR) < 2 * plan.record.se ? " (within noise)" : ""}.`
              : ""}
          </p>
          <p>{plan.entryType === "limit" ? "Limit entry: the price is not at the zone yet; the plan is valid only if price retraces to the entry. " : ""}The button opens the Trade tab: nothing is sent until an MT5 account is connected and you confirm. Educational, not financial advice.</p>
        </div>
      )}
    </div>
  );
}

/** Side-panel "Annotations detected": per-kind counts, each expandable to its items with price ranges (Pipflow-style). */
export function AnnotationSummary({ analysis, formatPrice }: { analysis: AnnotationResult | null; formatPrice: (n: number) => string }) {
  if (!analysis) return <p className="text-[14px] text-text-3">Press Analyze chart to map the structure.</p>;
  const c = analysis.counts;
  const list = analysis.annotations;
  const range = (lo: number, hi: number) => `${formatPrice(lo)} - ${formatPrice(hi)}`;
  const groups: { label: string; n: number; items: { name: string; value: string }[] }[] = [
    { label: "Lines", n: c.lines, items: list.flatMap((x) => (x.type === "structure" ? [{ name: `${x.kind} ${x.bias}`, value: formatPrice(x.price) }] : [])) },
    { label: "Zones", n: c.zones, items: list.flatMap((x) => (x.type === "zone" ? [{ name: x.label, value: range(x.low, x.high) }] : [])) },
    { label: "Markers", n: c.markers, items: list.flatMap((x) => (x.type === "marker" ? [{ name: `Sweep ${x.bias}`, value: formatPrice(x.price) }] : [])) },
    { label: "Levels", n: c.levels, items: list.flatMap((x) => (x.type === "level" ? [{ name: `S/R, ${x.touches} touches`, value: formatPrice(x.price) }] : [])) },
    { label: "Patterns", n: c.patterns, items: list.flatMap((x) => (x.type === "pattern" ? [{ name: x.label, value: `neckline ${formatPrice(x.neckline)}` }] : [])) },
    { label: "Sessions", n: c.sessions, items: list.flatMap((x) => (x.type === "session" ? [{ name: x.session, value: new Date(x.time).toISOString().slice(0, 16).replace("T", " ") + " UTC" }] : [])) },
  ];
  return (
    <div className="text-[14px] text-text-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold uppercase tracking-wide text-text-3">Annotations detected</span>
        <span className="rounded-full bg-ink-3 px-2 py-0.5 text-[12.5px]">{c.total}</span>
      </div>
      {groups.map((g) => (
        <details key={g.label} className="border-b border-border/60 py-1" open={g.label === "Zones"}>
          <summary className="flex cursor-pointer list-none items-center justify-between">
            <span className="font-medium text-text">{g.label}</span>
            <span className="text-text-3">{g.n}</span>
          </summary>
          <ul className="mt-1 space-y-0.5 pl-2">
            {g.items.map((it, i) => (
              <li key={`${it.name}-${i}`} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span>{it.name}</span>
                <span className="font-mono text-text-3">{it.value}</span>
              </li>
            ))}
            {g.items.length === 0 && <li className="text-[12.5px] text-text-3">None</li>}
          </ul>
        </details>
      ))}
      <p className="mt-2 text-[12.5px] text-text-3">Swing size {analysis.params.swingBars} bars, ATR(14) {analysis.params.atr.toPrecision(5)}. Descriptive map of what price already did, not a prediction.</p>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-gold" : "bg-ink-4"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

const ANALYSIS_CHILDREN: { key: keyof ChartLayers; label: string }[] = [
  { key: "zones", label: "Zones (OB / FVG)" },
  { key: "levels", label: "S/R levels" },
  { key: "structure", label: "Structure (BOS / CHoCH / sweeps)" },
  { key: "pdOte", label: "Premium / discount / OTE" },
  { key: "patterns", label: "Patterns" },
  { key: "sessions", label: "Sessions (London / New York)" },
];

interface ExtrasProps {
  layers: ChartLayers;
  onLayers: (patch: Partial<ChartLayers>) => void;
  onAnalyze: () => void;
  scanning: boolean;
  analyzed: boolean;
  onClean: () => void;
  soundOn: boolean;
  onSound: (on: boolean) => void;
}

/** Pro Chart top-bar controls: Analyze, Layers popup (toggle switches), Clean chart, sound switch. */
export function ProToolbarExtras({ layers, onLayers, onAnalyze, scanning, analyzed, onClean, soundOn, onSound }: ExtrasProps) {
  const [open, setOpen] = useState(false);
  const analysisOn = ANALYSIS_CHILDREN.some((c) => layers[c.key]);
  return (
    <div className="relative flex items-center gap-1.5">
      <button
        type="button"
        onClick={onAnalyze}
        disabled={scanning}
        className="h-8 rounded-md bg-gold px-3.5 text-[13px] font-semibold text-ink transition hover:brightness-110 disabled:opacity-60"
      >
        <span className="sm:hidden">{scanning ? "Analyzing…" : "Analyze"}</span>
        <span className="hidden sm:inline">{scanning ? "Analyzing…" : analyzed ? "Re-analyze" : "Analyze chart"}</span>
      </button>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Layers" title="Layers" className={`h-8 rounded-md px-2.5 max-sm:!hidden text-[13px] font-medium transition ${open ? "bg-ink-4 text-text" : "text-text-3 hover:bg-ink-4 hover:text-text"}`}>
        <span className="inline-flex items-center gap-1.5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" /></svg>Layers</span>
      </button>
      <button type="button" onClick={() => onSound(!soundOn)} aria-pressed={soundOn} aria-label={soundOn ? "Mute analysis sound" : "Unmute analysis sound"} title={soundOn ? "Sound on" : "Sound off"} className="h-8 rounded-md px-2 max-sm:!hidden text-[14px] text-text-3 transition hover:bg-ink-4 hover:text-text">
        {soundOn ? "🔊" : "🔇"}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border border-border bg-ink-3 p-3 shadow-2xl">
          <p className="mb-2 text-[12.5px] uppercase tracking-wide text-text-3">Layers</p>
          <div className="flex items-center justify-between py-1.5 text-[14px] font-semibold text-text">
            Drawings
            <Switch on={layers.drawings} onChange={(v) => onLayers({ drawings: v })} label="Drawings" />
          </div>
          <div className="flex items-center justify-between py-1.5 text-[14px] font-semibold text-text">
            Analysis
            <Switch on={analysisOn} onChange={(v) => onLayers(Object.fromEntries(ANALYSIS_CHILDREN.map((c) => [c.key, v && c.key !== "sessions"])) as Partial<ChartLayers>)} label="Analysis" />
          </div>
          {ANALYSIS_CHILDREN.map((c) => (
            <div key={c.key} className="flex items-center justify-between py-1 pl-3 text-[12.5px] text-text-2">
              {c.label}
              <Switch on={layers[c.key]} onChange={(v) => onLayers({ [c.key]: v })} label={c.label} />
            </div>
          ))}
          <div className="flex items-center justify-between py-1.5 text-[14px] font-semibold text-text">
            Trades
            <Switch on={layers.plan} onChange={(v) => onLayers({ plan: v })} label="Trade plan" />
          </div>
          <button type="button" onClick={() => { onClean(); setOpen(false); }} className="mt-2 w-full rounded-control border border-border bg-ink-3 py-1.5 text-[14px] text-text-2 hover:text-text">
            ✦ Clean chart
          </button>
        </div>
      )}
    </div>
  );
}
