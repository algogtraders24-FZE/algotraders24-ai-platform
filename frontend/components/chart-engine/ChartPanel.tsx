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
import { useState } from "react";
import AdvancedChart from "@/components/workspace/tradingview/AdvancedChart";
import { DEFAULT_INDICATOR_CONFIGS } from "@/lib/chart-engine/indicators/panel-registry";
import type { ChartProviderKind } from "@/types/chart-data";
import type { SignalTimeframe } from "@/types/signal";
import ChartProviderToggle from "./ChartProviderToggle";
import NativeChart from "./NativeChart";

const DEFAULT_NATIVE_TIMEFRAME: SignalTimeframe = "1h";

export default function ChartPanel() {
  const [provider, setProvider] = useState<ChartProviderKind>("tradingview");
  const [timeframe, setTimeframe] = useState<SignalTimeframe>(DEFAULT_NATIVE_TIMEFRAME);
  const [activeIndicatorKeys, setActiveIndicatorKeys] = useState<Set<string>>(new Set());

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
        />
      ) : (
        <AdvancedChart />
      )}
    </div>
  );
}
