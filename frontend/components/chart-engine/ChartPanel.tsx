"use client";

// components/chart-engine/ChartPanel.tsx
// Sprint D2.7.2, Phase 13 - composes the ChartProvider toggle with whichever
// chart it selects. Wired into the Workspace's existing "Chart"
// WorkspaceSection (app/dashboard/workspace/page.tsx) IN PLACE of a bare
// <AdvancedChart/>, but AdvancedChart itself is untouched and still the
// default - this sprint adds a coexisting option, never a replacement.
import { useState } from "react";
import AdvancedChart from "@/components/workspace/tradingview/AdvancedChart";
import type { ChartProviderKind } from "@/types/chart-data";
import ChartProviderToggle from "./ChartProviderToggle";
import NativeChart from "./NativeChart";

export default function ChartPanel() {
  const [provider, setProvider] = useState<ChartProviderKind>("tradingview");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <ChartProviderToggle value={provider} onChange={setProvider} />
      </div>
      {provider === "native" ? <NativeChart /> : <AdvancedChart />}
    </div>
  );
}
