"use client";

// components/chart-engine/ChartToolbar.tsx
// Sprint D2.7.3, Phase 10 - the professional AT24 chart header: symbol,
// timeframe (reusing the existing ChartTimeframeSelector/SIGNAL_TIMEFRAMES
// - never a second timeframe union), an Indicators menu driven entirely by
// panel-registry.ts's DEFAULT_INDICATOR_CONFIGS (never a hardcoded list
// duplicated here), Fit, and Live/Go-to-latest.
//
// Sprint D2.7.5, Phase 4/5/9/17 - the Indicators menu now groups entries
// into "Overlays" (price panel) vs "Panels" (own sub-panel row) via the
// static INDICATOR_PANEL_ID lookup (panel-registry.ts) - a real, previously
// missing distinction the sprint's audit found (Phase 4's explicit ask).
// The menu now closes on Escape and on an outside click (a real,
// previously-missing dismissal path - it used to only toggle via its own
// button). Controls are grouped logically: symbol/timeframe on the left,
// indicators/view controls on the right. Adds the Fullscreen toggle
// (Phase 9), wrapped in the existing Tooltip component - never a new one.
import { useEffect, useRef, useState } from "react";
import Tooltip from "@/components/ui/Tooltip";
import { FIN_LABEL } from "@/components/ui/financial-typography";
import { DEFAULT_INDICATOR_CONFIGS, INDICATOR_PANEL_ID } from "@/lib/chart-engine/indicators/panel-registry";
import type { SignalTimeframe } from "@/types/signal";
import type { ChartTemplate } from "@/lib/chart-engine/templates/types";
import type { ChartRenderType } from "@/lib/chart-engine/types";
import ChartTimeframeSelector from "./ChartTimeframeSelector";

const CHART_TYPES: { value: ChartRenderType; label: string; title: string }[] = [
  { value: "candlestick", label: "Candles", title: "Candlesticks" },
  { value: "bar", label: "Bars", title: "Bar chart" },
  { value: "line", label: "Line", title: "Line chart" },
];

export interface ChartToolbarProps {
  displaySymbol: string;
  timeframe: SignalTimeframe;
  onTimeframeChange: (timeframe: SignalTimeframe) => void;
  /** Sprint D2.7.11 Phase 5 - MT5's Bar chart / Candlesticks / Line chart toggle (right-click chart menu, Alt+1/2/3 in real MT5). */
  chartType: ChartRenderType;
  onChartTypeChange: (chartType: ChartRenderType) => void;
  activeIndicatorKeys: ReadonlySet<string>;
  onToggleIndicator: (key: string) => void;
  onFit: () => void;
  onGoLive: () => void;
  isLive: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Sprint D2.7.11 Phase 4 - saved chart templates (MT5's own real Template feature). */
  templates: readonly ChartTemplate[];
  onApplyTemplate: (template: ChartTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  onOpenSaveTemplate: () => void;
  /** Sprint D2.7.11 Phase 5b - MT5's Properties dialog (F8 in real MT5). */
  onOpenProperties: () => void;
  /** Sprint D2.7.11 Phase 5d - MT5's "Save as Picture" (right-click chart menu). */
  onSaveAsPicture: () => void;
  /** P3.2B - opens the Algo Testing (Pro) configuration modal (AlgoTestPanel.tsx). */
  onOpenAlgoTest: () => void;
}

const OVERLAY_CONFIGS = DEFAULT_INDICATOR_CONFIGS.filter((cfg) => INDICATOR_PANEL_ID[cfg.id] === "price");
const PANEL_CONFIGS = DEFAULT_INDICATOR_CONFIGS.filter((cfg) => INDICATOR_PANEL_ID[cfg.id] !== "price");

export default function ChartToolbar({
  displaySymbol,
  timeframe,
  onTimeframeChange,
  chartType,
  onChartTypeChange,
  activeIndicatorKeys,
  onToggleIndicator,
  onFit,
  onGoLive,
  isLive,
  isFullscreen,
  onToggleFullscreen,
  templates,
  onApplyTemplate,
  onDeleteTemplate,
  onOpenSaveTemplate,
  onOpenProperties,
  onSaveAsPicture,
  onOpenAlgoTest,
}: ChartToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [templatesMenuOpen, setTemplatesMenuOpen] = useState(false);
  const templatesMenuRef = useRef<HTMLDivElement>(null);

  // Sprint D2.7.5 - close on Escape and on an outside click, the two
  // dismissal paths every other dropdown in this codebase already supports
  // (Dropdown.tsx) that this menu was previously missing entirely.
  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  // Sprint D2.7.11 Phase 4 - the Templates menu is a second, independent
  // dropdown - same dismissal pattern as the Indicators menu above, kept
  // as its own state/ref rather than a shared "which menu is open" enum
  // so the two can never accidentally interfere with each other.
  useEffect(() => {
    if (!templatesMenuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (templatesMenuRef.current && !templatesMenuRef.current.contains(e.target as Node)) setTemplatesMenuOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setTemplatesMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [templatesMenuOpen]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${FIN_LABEL} rounded-control border border-border bg-ink-3 px-2 py-1`}>{displaySymbol}</span>
        <ChartTimeframeSelector value={timeframe} onChange={onTimeframeChange} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Chart type" className="flex items-center gap-0.5 rounded-control border border-border bg-ink-3 p-0.5">
          {CHART_TYPES.map((ct) => (
            <button
              key={ct.value}
              type="button"
              onClick={() => onChartTypeChange(ct.value)}
              aria-pressed={chartType === ct.value}
              title={ct.title}
              className={`rounded-[4px] px-2 py-1 text-[11px] font-medium transition ${
                chartType === ct.value ? "bg-gold text-ink" : "text-text-3 hover:bg-ink-4 hover:text-text"
              }`}
            >
              {ct.label}
            </button>
          ))}
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="true"
            className="rounded-control border border-border bg-ink-3 px-2.5 py-1 text-[11px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text"
          >
            Indicators{activeIndicatorKeys.size > 0 ? ` (${activeIndicatorKeys.size})` : ""}
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="Chart indicators"
              className="absolute right-0 top-full z-10 mt-1 w-56 rounded-panel border border-border bg-ink-2 p-1.5 shadow-raised"
            >
              <IndicatorGroup label="Overlays" configs={OVERLAY_CONFIGS} activeIndicatorKeys={activeIndicatorKeys} onToggleIndicator={onToggleIndicator} />
              <IndicatorGroup label="Panels" configs={PANEL_CONFIGS} activeIndicatorKeys={activeIndicatorKeys} onToggleIndicator={onToggleIndicator} />
            </div>
          )}
        </div>

        <div className="relative" ref={templatesMenuRef}>
          <button
            type="button"
            onClick={() => setTemplatesMenuOpen((v) => !v)}
            aria-expanded={templatesMenuOpen}
            aria-haspopup="true"
            className="rounded-control border border-border bg-ink-3 px-2.5 py-1 text-[11px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text"
          >
            Templates
          </button>
          {templatesMenuOpen && (
            <div role="menu" aria-label="Chart templates" className="absolute right-0 top-full z-10 mt-1 w-64 rounded-panel border border-border bg-ink-2 p-1.5 shadow-raised">
              <button
                type="button"
                onClick={() => {
                  setTemplatesMenuOpen(false);
                  onOpenSaveTemplate();
                }}
                className="w-full rounded-control px-2 py-1.5 text-left text-xs font-medium text-gold hover:bg-ink-3"
              >
                Save current as template…
              </button>
              {templates.length > 0 && (
                <div className="mt-1 border-t border-border pt-1">
                  <p className={`${FIN_LABEL} px-2 pb-1 pt-1`}>Saved</p>
                  {templates.map((tpl) => (
                    <div key={tpl.id} className="group flex items-center gap-1 rounded-control px-2 py-1.5 hover:bg-ink-3">
                      <button
                        type="button"
                        onClick={() => {
                          setTemplatesMenuOpen(false);
                          onApplyTemplate(tpl);
                        }}
                        title={`Apply "${tpl.name}"`}
                        className="flex-1 truncate text-left text-xs text-text-2"
                      >
                        {tpl.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTemplate(tpl.id)}
                        aria-label={`Delete template "${tpl.name}"`}
                        title="Delete template"
                        className="rounded-control px-1.5 text-xs text-text-3 opacity-0 transition hover:text-signal-down group-hover:opacity-100"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenAlgoTest}
          title="Test a strategy against real historical data"
          aria-label="Algo Test"
          className="rounded-control border border-gold/40 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-gold transition hover:bg-gold/20"
        >
          Algo Test
        </button>

        <button
          type="button"
          onClick={onOpenProperties}
          title="Chart properties (grid, period separators)"
          aria-label="Chart properties"
          className="rounded-control border border-border bg-ink-3 px-2.5 py-1 text-[11px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text"
        >
          Properties
        </button>

        <button
          type="button"
          onClick={onSaveAsPicture}
          title="Save the current chart as a PNG image"
          aria-label="Save chart as picture"
          className="rounded-control border border-border bg-ink-3 px-2.5 py-1 text-[11px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text"
        >
          Save Image
        </button>

        <button
          type="button"
          onClick={onFit}
          title="Fit the chart to the loaded candle range"
          className="rounded-control border border-border bg-ink-3 px-2.5 py-1 text-[11px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text"
        >
          Fit
        </button>

        <button
          type="button"
          onClick={onGoLive}
          aria-pressed={isLive}
          title="Jump to the latest candle and follow live updates"
          className={`rounded-control border px-2.5 py-1 text-[11px] font-medium transition ${
            isLive ? "border-signal-up/40 bg-signal-up/10 text-signal-up" : "border-border bg-ink-3 text-text-3 hover:bg-ink-4 hover:text-text"
          }`}
        >
          {isLive ? "● Live" : "Go to latest"}
        </button>

        <Tooltip label={isFullscreen ? "Exit fullscreen (Esc)" : "Expand chart to fullscreen"}>
          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className="rounded-control border border-border bg-ink-3 px-2.5 py-1 text-[11px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text"
          >
            {isFullscreen ? "⤡" : "⤢"}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function IndicatorGroup({
  label,
  configs,
  activeIndicatorKeys,
  onToggleIndicator,
}: {
  label: string;
  configs: typeof DEFAULT_INDICATOR_CONFIGS;
  activeIndicatorKeys: ReadonlySet<string>;
  onToggleIndicator: (key: string) => void;
}) {
  if (configs.length === 0) return null;
  return (
    <div className="mb-1 last:mb-0">
      <p className={`${FIN_LABEL} px-2 pb-1 pt-1`}>{label}</p>
      {configs.map((cfg) => (
        <label
          key={cfg.key}
          className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-xs text-text-2 hover:bg-ink-3"
        >
          <input
            type="checkbox"
            checked={activeIndicatorKeys.has(cfg.key)}
            onChange={() => onToggleIndicator(cfg.key)}
            className="accent-gold"
          />
          {cfg.key.toUpperCase()}
        </label>
      ))}
    </div>
  );
}
