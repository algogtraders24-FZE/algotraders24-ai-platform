"use client";
// components/chart-engine/ProTopBar.tsx
// One-row top bar of the Pro Chart, laid out like the reference chart: back, symbol, M1 M5 M15 M30 H1 H4 D1 W1, chart type
// dropdown (with one-line descriptions), indicators, then on the right Analyze / Layers / sound, live dot and a "more" menu.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SIGNAL_TIMEFRAMES, type SignalTimeframe } from "@/types/signal";
import type { ChartRenderType } from "@/lib/chart-engine/types";
import type { ChartTemplate } from "@/lib/chart-engine/templates/types";
import { IndicatorsMenu } from "./ChartToolbar";

const TF_LABEL: Record<SignalTimeframe, string> = { "1m": "M1", "5m": "M5", "15m": "M15", "30m": "M30", "1h": "H1", "4h": "H4", "1d": "D1", "1w": "W1" };

const TYPES: { value: ChartRenderType; label: string; desc: string; icon: ReactNode }[] = [
  { value: "candlestick", label: "Candlestick", desc: "Japanese candlestick OHLC", icon: <path d="M7 5v14M7 8h0M5 8h4v7H5zM17 3v18M15 6h4v8h-4z" /> },
  { value: "bar", label: "Bar", desc: "OHLC bar chart", icon: <path d="M7 4v16M4 8h3M7 15h3M17 3v17M14 6h3M17 13h3" /> },
  { value: "line", label: "Line", desc: "Close prices line", icon: <path d="M3 17l5-6 4 3 8-9" /> },
  { value: "area", label: "Area", desc: "Filled gradient area", icon: <path d="M3 17l5-6 4 3 8-9v13H3z" /> },
];

interface Props {
  leading: ReactNode;
  onBack?: () => void;
  timeframe: SignalTimeframe;
  onTimeframeChange: (t: SignalTimeframe) => void;
  chartType: ChartRenderType;
  onChartTypeChange: (t: ChartRenderType) => void;
  activeIndicatorKeys: ReadonlySet<string>;
  onToggleIndicator: (key: string) => void;
  extra: ReactNode;
  isLive: boolean;
  onGoLive: () => void;
  onFit: () => void;
  templates: readonly ChartTemplate[];
  onApplyTemplate: (t: ChartTemplate) => void;
  onOpenSaveTemplate: () => void;
  onOpenProperties: () => void;
  onSaveAsPicture: () => void;
  onOpenAlgoTest: () => void;
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

const GHOST = "flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text";

// module level on purpose: a component created inside ProTopBar would be a new type on every render and remount its svg each time
const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export default function ProTopBar(p: Props) {
  const [typeOpen, setTypeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const typeRef = useDismiss(typeOpen, () => setTypeOpen(false));
  const moreRef = useDismiss(moreOpen, () => setMoreOpen(false));
  const current = TYPES.find((t) => t.value === p.chartType) ?? TYPES[0];

  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-ink-2 px-2 text-text-2 sm:px-3">
      {p.onBack && (
        <button type="button" onClick={p.onBack} aria-label="Back to the dashboard" title="Back to the dashboard" className="hidden h-8 w-8 items-center sm:flex justify-center rounded-md text-text-3 hover:bg-ink-4 hover:text-text">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
      )}
      {p.leading}
      <select
        aria-label="Chart timeframe"
        value={p.timeframe}
        onChange={(e) => p.onTimeframeChange(e.target.value as SignalTimeframe)}
        className="h-8 rounded-md border border-border bg-ink-3 px-1.5 text-[13px] font-semibold text-text md:hidden"
      >
        {SIGNAL_TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{TF_LABEL[tf]}</option>)}
      </select>
      <div role="group" aria-label="Chart timeframe" className="ml-1 hidden items-center gap-0.5 md:flex">
        {SIGNAL_TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            type="button"
            onClick={() => p.onTimeframeChange(tf)}
            aria-pressed={p.timeframe === tf}
            className={`h-8 min-w-[34px] rounded-md px-2 text-[13px] font-medium transition ${p.timeframe === tf ? "bg-gold text-ink" : "text-text-3 hover:bg-ink-4 hover:text-text"}`}
          >
            {TF_LABEL[tf]}
          </button>
        ))}
      </div>

      <div className="relative ml-1 hidden md:block" ref={typeRef}>
        <button type="button" onClick={() => setTypeOpen((v) => !v)} aria-expanded={typeOpen} aria-haspopup="menu" aria-label="Chart type" title="Chart type" className={`${GHOST} gap-1.5`}>
          <Icon>{current.icon}</Icon>
        </button>
        {typeOpen && (
          <div role="menu" className="absolute left-0 top-full z-40 mt-1 w-64 rounded-lg border border-border bg-ink-3 p-1.5 shadow-2xl">
            {TYPES.map((t) => (
              <button key={t.value} type="button" role="menuitemradio" aria-checked={p.chartType === t.value} onClick={() => { p.onChartTypeChange(t.value); setTypeOpen(false); }} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-ink-4">
                <span className="text-text-3"><Icon>{t.icon}</Icon></span>
                <span className="flex-1">
                  <span className="block text-[13px] font-medium text-text">{t.label}</span>
                  <span className="block text-[11px] text-text-3">{t.desc}</span>
                </span>
                {p.chartType === t.value && <span className="text-gold">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <IndicatorsMenu activeIndicatorKeys={p.activeIndicatorKeys} onToggleIndicator={p.onToggleIndicator} buttonClassName={GHOST} />

      <div className="flex-1" />
      {p.extra}
      <button type="button" onClick={p.onGoLive} aria-pressed={p.isLive} title={p.isLive ? "Live: following the latest candle" : "Go to the latest candle"} className={`${GHOST} gap-1.5 max-sm:!hidden`}>
        <span className={`h-2 w-2 rounded-full ${p.isLive ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" : "bg-[#6b7280]"}`} />
        <span className="text-[12px]">{p.isLive ? "Live" : "Latest"}</span>
      </button>

      <div className="relative" ref={moreRef}>
        <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} aria-haspopup="menu" aria-label="More" title="More" className={`${GHOST} px-2`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
        </button>
        {moreOpen && (
          <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-60 rounded-lg border border-border bg-ink-3 p-1.5 shadow-2xl">
            {[
              ["Fit chart to data", p.onFit],
              ["Algo Test", p.onOpenAlgoTest],
              ["Chart properties", p.onOpenProperties],
              ["Screenshot", p.onSaveAsPicture],
              ["Save current as template…", p.onOpenSaveTemplate],
            ].map(([label, fn]) => (
              <button key={label as string} type="button" role="menuitem" onClick={() => { setMoreOpen(false); (fn as () => void)(); }} className="w-full rounded-md px-2 py-2 text-left text-[13px] text-text-2 hover:bg-ink-4">{label as string}</button>
            ))}
            {p.templates.length > 0 && (
              <div className="mt-1 border-t border-border pt-1">
                <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-text-3">Saved setups</p>
                {p.templates.map((t) => (
                  <button key={t.id} type="button" role="menuitem" onClick={() => { setMoreOpen(false); p.onApplyTemplate(t); }} className="w-full truncate rounded-md px-2 py-2 text-left text-[13px] text-text-2 hover:bg-ink-4">{t.name}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
