"use client";
// components/chart-engine/ProChartApp.tsx
// The Pro Chart with its own symbol / timeframe / indicator state and the providers it needs. Used full-window by /dashboard/chart and, with
// `embedded`, inside the dashboard home as a preview. Starts on the user's first favourite symbol when there is one.
import { useEffect, useState } from "react";
import { WorkspaceProvider, useWorkspace } from "@/context/WorkspaceContext";
import { PaperTradingProvider } from "@/context/PaperTradingContext";
import ProSymbolPicker from "@/components/chart-engine/ProSymbolPicker";
import NativeChart from "@/components/chart-engine/NativeChart";
import { DEFAULT_INDICATOR_CONFIGS } from "@/lib/chart-engine/indicators/panel-registry";
import { getMarket } from "@/lib/market-data/market-registry";
import type { SignalTimeframe } from "@/types/signal";

function ProChartInner({ embedded }: { embedded: boolean }) {
  const { symbol: initialSymbol } = useWorkspace();
  const [symbol, setSymbol] = useState<string>(initialSymbol);
  const [timeframe, setTimeframe] = useState<SignalTimeframe>("1h");
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const known = new Set(DEFAULT_INDICATOR_CONFIGS.map((c) => c.key));

  // the first favourite is where the trader wants to land
  useEffect(() => {
    try {
      const favs = JSON.parse(localStorage.getItem("at24.chart.favourites") ?? "[]");
      if (Array.isArray(favs) && typeof favs[0] === "string") setSymbol(favs[0]);
    } catch { /* no favourites readable: keep the workspace symbol */ }
  }, []);

  return (
    <NativeChart
      proLayout
      embedded={embedded}
      symbolPicker={<ProSymbolPicker value={symbol} onChange={setSymbol} />}
      symbol={symbol}
      name={getMarket(symbol)?.name}
      timeframe={timeframe}
      onTimeframeChange={setTimeframe}
      onSymbolChange={setSymbol}
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
  );
}

export default function ProChartApp({ embedded = false }: { embedded?: boolean }) {
  return (
    <WorkspaceProvider>
      <PaperTradingProvider>
        <ProChartInner embedded={embedded} />
      </PaperTradingProvider>
    </WorkspaceProvider>
  );
}
