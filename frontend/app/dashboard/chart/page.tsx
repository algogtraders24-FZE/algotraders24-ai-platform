"use client";

// app/dashboard/chart/page.tsx - Pro Chart: the native chart in Professional Mode layout
// (big chart, right side panel with trade plan and annotations, account / algo-test panels below).
import { useState } from "react";
import { WorkspaceProvider, useWorkspace } from "@/context/WorkspaceContext";
import { PaperTradingProvider } from "@/context/PaperTradingContext";
import ProSymbolPicker from "@/components/chart-engine/ProSymbolPicker";
import NativeChart from "@/components/chart-engine/NativeChart";
import { DEFAULT_INDICATOR_CONFIGS } from "@/lib/chart-engine/indicators/panel-registry";
import { getMarket } from "@/lib/market-data/market-registry";
import type { SignalTimeframe } from "@/types/signal";

function ProChart() {
  const { symbol, setSymbol } = useWorkspace();
  const [timeframe, setTimeframe] = useState<SignalTimeframe>("1h");
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const known = new Set(DEFAULT_INDICATOR_CONFIGS.map((c) => c.key));
  return (
    <div className="space-y-3">
      <NativeChart
        proLayout
        symbolPicker={<ProSymbolPicker value={symbol} onChange={setSymbol} />}
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
