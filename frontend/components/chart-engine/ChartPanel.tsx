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
import { useEffect, useRef, useState } from "react";
import AdvancedChart from "@/components/workspace/tradingview/AdvancedChart";
import { DEFAULT_INDICATOR_CONFIGS } from "@/lib/chart-engine/indicators/panel-registry";
import { readChartSessionState, writeChartSessionState } from "@/lib/chart-engine/chart-session-state";
import type { ChartProviderKind } from "@/types/chart-data";
import type { SignalTimeframe } from "@/types/signal";
import ChartProviderToggle from "./ChartProviderToggle";
import NativeChart from "./NativeChart";

const DEFAULT_NATIVE_TIMEFRAME: SignalTimeframe = "1h";

export default function ChartPanel() {
  const [provider, setProvider] = useState<ChartProviderKind>("tradingview");
  const [timeframe, setTimeframe] = useState<SignalTimeframe>(DEFAULT_NATIVE_TIMEFRAME);
  const [activeIndicatorKeys, setActiveIndicatorKeys] = useState<Set<string>>(new Set());
  const hydratedRef = useRef(false);

  useEffect(() => {
    const saved = readChartSessionState();
    if (saved.provider) setProvider(saved.provider);
    if (saved.timeframe) setTimeframe(saved.timeframe);
    if (saved.indicatorKeys) setActiveIndicatorKeys(new Set(saved.indicatorKeys));
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return; // don't overwrite a not-yet-restored saved value with the still-default initial state
    writeChartSessionState({ provider, timeframe, indicatorKeys: Array.from(activeIndicatorKeys) });
  }, [provider, timeframe, activeIndicatorKeys]);

  function toggleIndicator(key: string) {
    const isKnown = DEFAULT_INDICATOR_CONFIGS.some((cfg) => cfg.key === key);
    if (!isKnown) return; // never accept an indicator key the registry doesn't recognize
    setActiveIndicatorKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Sprint D2.7.11 Phase 4 - applying a saved template replaces the WHOLE
  // active set at once (never a series of individual toggles), same
  // "known keys only" filter as toggleIndicator above.
  function applyIndicatorKeys(keys: readonly string[]) {
    const known = new Set(DEFAULT_INDICATOR_CONFIGS.map((cfg) => cfg.key));
    setActiveIndicatorKeys(new Set(keys.filter((k) => known.has(k))));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <ChartProviderToggle value={provider} onChange={setProvider} />
      </div>
      {provider === "native" ? (
        <NativeChart
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          activeIndicatorKeys={activeIndicatorKeys}
          onToggleIndicator={toggleIndicator}
          onApplyIndicatorKeys={applyIndicatorKeys}
        />
      ) : (
        <AdvancedChart />
      )}
    </div>
  );
}
