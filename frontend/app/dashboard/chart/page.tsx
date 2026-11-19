"use client";

// app/dashboard/chart/page.tsx - Pro Chart: the native chart in Professional Mode layout
// (big chart, right side panel with trade plan and annotations, account / algo-test panels below).
import { useState } from "react";
import { WorkspaceProvider, useWorkspace } from "@/context/WorkspaceContext";
import { PaperTradingProvider } from "@/context/PaperTradingContext";
import GlobalSymbolSelector from "@/components/workspace/GlobalSymbolSelector";
import NativeChart from "@/components/chart-engine/NativeChart";
import { DEFAULT_INDICATOR_CONFIGS } from "@/lib/chart-engine/indicators/panel-registry";
import { getMarket } from "@/lib/market-data/market-registry";
import type { SignalTimeframe } from "@/types/signal";

function ProChart() {
  const { symbol } = useWorkspace();
  const [timeframe, setTimeframe] = useState<SignalTimeframe>("1h");
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const known = new Set(DEFAULT_INDICATOR_CONFIGS.map((c) => c.key));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-medium">Pro Chart</h1>
        <GlobalSymbolSelector />
      </div>
      <NativeChart
        proLayout
        symbol={symbol}
        name={getMarket(symbol)?.name}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        activeIndicatorKeys={keys}
        onToggleIndicator={(k) => {
          if (!known.has(k)) return;
          setKeys((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
          });
        }}
        onApplyIndicatorKeys={(ks) => setKeys(new Set(ks.filter((k) => known.has(k))))}
      />
    </div>
  );
}

export default function ProChartPage() {
  return (
    <WorkspaceProvider>
      <PaperTradingProvider>
        <ProChart />
      </PaperTradingProvider>
    </WorkspaceProvider>
  );
}
