"use client";

// components/chart-engine/ChartPanel.tsx
// Sprint D2.7.2, Phase 13 - composes the ChartProvider toggle with whichever
// chart it selects. Wired into the Workspace's existing "Chart"
// WorkspaceSection (app/dashboard/workspace/page.tsx) IN PLACE of a bare
// <AdvancedChart/>, but AdvancedChart itself is untouched and still the
// default - this sprint adds a coexisting option, never a replacement.
//
// Sprint D2.7.4 - now OWNS the native chart's timeframe/active-indicator
// selection (lifted up from NativeChart's own former local state). Fixes a
// real Phase 11 bug: NativeChart previously reset to its defaults ("1h",
// no indicators) every time the provider ternary below unmounted it - i.e.
// every single switch to TradingView and back - because that state lived
// inside the very component being unmounted. ChartPanel itself never
// unmounts on a provider toggle, so state stored here survives the switch.
// The selected canonical instrument was never affected by this bug (it
// always lived in WorkspaceContext, shared and untouched by either chart).
//
// Sprint D2.7.5, Phase 8 - Chart State Persistence. This same state (owned
// here since D2.7.4) now also survives a same-tab reload/navigation via
// chart-session-state.ts's sessionStorage helpers - restored once via an
// effect AFTER mount (never a useState initializer - reading sessionStorage
// synchronously there would make the client's first render diverge from
// the server-rendered HTML and trigger a hydration mismatch, the exact
// reason WorkspaceContext's own preferences already restore via an effect
// rather than a synchronous initializer). `hydratedRef` prevents the
// still-default state from being persisted BACK over a real saved value in
// the brief instant before that restore effect has run.
//
// Sprint D2.7.11 Phase 3 - multi-symbol TILED layout (real, simultaneously-
// visible charts, not just tabs - see the roadmap doc's own design-pass
// note for why this needed a dedicated pass before any code). Native-
// engine only: the provider toggle stays exactly as it always has (global,
// TradingView vs Native); a layout selector (1 / 2 / 2x2) only appears
// when Native is active, and AdvancedChart continues to be a single,
// non-tiled instance always following WorkspaceContext's own symbol,
// completely untouched. `panes` always has exactly `layout` entries (front-
// truncated on shrink, grown from the primary pane's symbol on grow) -
// deliberately not "always keep 4 in memory, just hide some": simpler,
// and closing back down to fewer panes is an honest "these are gone", the
// same way closing a real window in MT5 is.
//
// Exactly one pane is "primary" and is kept bidirectionally in sync with
// WorkspaceContext.symbol: switching which pane is primary (or changing
// the primary pane's own symbol) updates the page's shared active symbol,
// so the header/AI Intelligence/Assistant/Research/ribbon keep following
// whichever chart the user has designated as the one driving the rest of
// the workspace - exactly the existing single-chart behavior, just now a
// deliberate choice among several open panes instead of the only option.
// Every OTHER pane owns a fully independent symbol with no such sync.
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import AdvancedChart from "@/components/workspace/tradingview/AdvancedChart";
import { DEFAULT_INDICATOR_CONFIGS } from "@/lib/chart-engine/indicators/panel-registry";
import { readChartSessionState, writeChartSessionState, type ChartLayout } from "@/lib/chart-engine/chart-session-state";
import type { ChartProviderKind } from "@/types/chart-data";
import type { SignalTimeframe } from "@/types/signal";
import ChartProviderToggle from "./ChartProviderToggle";
import ChartPane, { type ChartPaneState } from "./ChartPane";

const DEFAULT_NATIVE_TIMEFRAME: SignalTimeframe = "1h";
const LAYOUTS: readonly ChartLayout[] = [1, 2, 4];

function newPaneId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makePane(symbol: string): ChartPaneState {
  return { id: newPaneId(), symbol, timeframe: DEFAULT_NATIVE_TIMEFRAME, activeIndicatorKeys: new Set() };
}

function layoutForRestoredCount(count: number): ChartLayout {
  if (count >= 3) return 4;
  if (count === 2) return 2;
  return 1;
}

export default function ChartPanel() {
  const { symbol: contextSymbol, setSymbol: setContextSymbol } = useWorkspace();
  const [provider, setProvider] = useState<ChartProviderKind>("tradingview");
  const [layout, setLayoutState] = useState<ChartLayout>(1);
  const [panes, setPanes] = useState<ChartPaneState[]>(() => [makePane(contextSymbol)]);
  const [primaryPaneId, setPrimaryPaneId] = useState<string>(() => panes[0].id);
  const hydratedRef = useRef(false);

  // Restore saved session state once, after mount (see this file's own
  // header comment for why never a useState initializer). Runs BEFORE the
  // "keep primary pane synced from context" effect below (React fires
  // same-render effects in declaration order), so if the restored primary
  // pane's saved symbol differs from WorkspaceContext's own (durable,
  // cross-device) symbol, the sync effect immediately corrects it - the
  // context symbol is always authoritative for whichever pane is primary.
  useEffect(() => {
    const saved = readChartSessionState();
    if (saved.provider) setProvider(saved.provider);
    if (saved.panes && saved.panes.length > 0) {
      const restored = saved.panes.map((p) => ({ id: newPaneId(), symbol: p.symbol, timeframe: p.timeframe, activeIndicatorKeys: new Set(p.indicatorKeys) }));
      setPanes(restored);
      setLayoutState(saved.layout ?? layoutForRestoredCount(restored.length));
      const primaryIndex = saved.primaryPaneIndex !== undefined && saved.primaryPaneIndex < restored.length ? saved.primaryPaneIndex : 0;
      setPrimaryPaneId(restored[primaryIndex].id);
    }
    hydratedRef.current = true;
  }, []);

  // Keeps the PRIMARY pane's symbol equal to WorkspaceContext's own
  // symbol - the one direction of the bidirectional sync (context ->
  // primary pane). The other direction (a user editing the primary pane's
  // own search box, or promoting a different pane to primary) goes through
  // setContextSymbol directly (see setPaneSymbol/setPrimary below), which
  // lands back here on the next render - one real source of truth
  // (WorkspaceContext.symbol) for the primary pane, never two.
  useEffect(() => {
    setPanes((prev) => prev.map((p) => (p.id === primaryPaneId && p.symbol !== contextSymbol ? { ...p, symbol: contextSymbol } : p)));
  }, [contextSymbol, primaryPaneId]);

  // A layout shrink can drop the pane that was primary - fall back to the
  // first remaining (always-visible) pane rather than leaving primary
  // pointing at a pane that no longer exists.
  useEffect(() => {
    if (panes.length > 0 && !panes.some((p) => p.id === primaryPaneId)) setPrimaryPaneId(panes[0].id);
  }, [panes, primaryPaneId]);

  useEffect(() => {
    if (!hydratedRef.current) return; // don't overwrite a not-yet-restored saved value with the still-default initial state
    const primaryIndex = Math.max(0, panes.findIndex((p) => p.id === primaryPaneId));
    writeChartSessionState({
      provider,
      layout,
      panes: panes.map((p) => ({ symbol: p.symbol, timeframe: p.timeframe, indicatorKeys: Array.from(p.activeIndicatorKeys) })),
      primaryPaneIndex: primaryIndex,
    });
  }, [provider, layout, panes, primaryPaneId]);

  function setLayout(next: ChartLayout) {
    setPanes((prev) => {
      if (next === prev.length) return prev;
      if (next < prev.length) return prev.slice(0, next);
      const templateSymbol = prev.find((p) => p.id === primaryPaneId)?.symbol ?? prev[0]?.symbol ?? contextSymbol;
      return [...prev, ...Array.from({ length: next - prev.length }, () => makePane(templateSymbol))];
    });
    setLayoutState(next);
  }

  function updatePane(id: string, updater: (pane: ChartPaneState) => ChartPaneState) {
    setPanes((prev) => prev.map((p) => (p.id === id ? updater(p) : p)));
  }

  function setPaneSymbol(id: string, symbol: string) {
    if (id === primaryPaneId) setContextSymbol(symbol);
    else updatePane(id, (p) => ({ ...p, symbol }));
  }

  function setPaneTimeframe(id: string, timeframe: SignalTimeframe) {
    updatePane(id, (p) => ({ ...p, timeframe }));
  }

  function togglePaneIndicator(id: string, key: string) {
    const isKnown = DEFAULT_INDICATOR_CONFIGS.some((cfg) => cfg.key === key);
    if (!isKnown) return; // never accept an indicator key the registry doesn't recognize
    updatePane(id, (p) => {
      const next = new Set(p.activeIndicatorKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...p, activeIndicatorKeys: next };
    });
  }

  // Sprint D2.7.11 Phase 4 - applying a saved template replaces the WHOLE
  // active set at once (never a series of individual toggles), same
  // "known keys only" filter as togglePaneIndicator above.
  function applyPaneIndicatorKeys(id: string, keys: readonly string[]) {
    const known = new Set(DEFAULT_INDICATOR_CONFIGS.map((cfg) => cfg.key));
    updatePane(id, (p) => ({ ...p, activeIndicatorKeys: new Set(keys.filter((k) => known.has(k))) }));
  }

  function setPrimary(id: string) {
    const pane = panes.find((p) => p.id === id);
    if (!pane) return;
    setContextSymbol(pane.symbol);
    setPrimaryPaneId(id);
  }

  const gridClass = layout === 1 ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {provider === "native" && (
          <div role="group" aria-label="Chart layout" className="flex items-center gap-0.5 rounded-control border border-border bg-ink-3 p-0.5">
            {LAYOUTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setLayout(n)}
                aria-pressed={layout === n}
                title={n === 1 ? "One chart" : n === 2 ? "Two charts side by side" : "Four charts, 2×2"}
                className={`rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition ${
                  layout === n ? "bg-gold text-ink" : "text-text-3 hover:bg-ink-4 hover:text-text"
                }`}
              >
                {n === 1 ? "1" : n === 2 ? "2" : "2×2"}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto">
          <ChartProviderToggle value={provider} onChange={setProvider} />
        </div>
      </div>
      {provider === "native" ? (
        <div className={`grid gap-3 ${gridClass}`}>
          {panes.map((pane) => (
            <ChartPane
              key={pane.id}
              pane={pane}
              isPrimary={pane.id === primaryPaneId}
              showControls={panes.length > 1}
              onSymbolChange={(symbol) => setPaneSymbol(pane.id, symbol)}
              onTimeframeChange={(tf) => setPaneTimeframe(pane.id, tf)}
              onToggleIndicator={(key) => togglePaneIndicator(pane.id, key)}
              onApplyIndicatorKeys={(keys) => applyPaneIndicatorKeys(pane.id, keys)}
              onSetPrimary={() => setPrimary(pane.id)}
            />
          ))}
        </div>
      ) : (
        <AdvancedChart />
      )}
    </div>
  );
}
