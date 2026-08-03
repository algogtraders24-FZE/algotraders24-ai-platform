"use client";

// app/dashboard/workspace/page.tsx
// Sprint D2.3 (Phase 2) - the Intelligence Workspace scaffold. A new, dedicated
// route (existing module pages are untouched). It establishes the final layout
// order and the shared symbol state; later phases fill each region:
//   Market Ribbon (P4) → Workspace Header → TradingView Chart (P5) →
//   AI Intelligence (P6, the CENTER) → Technical Indicators (P6) →
//   Evidence (P6) → Assistant → Research (D2.4).
// Positioning is enforced structurally: the AI Intelligence panel carries the
// `emphasis` treatment; the chart is a supporting panel above it, never the
// headline. The Global Symbol Selector drives every panel through
// WorkspaceContext.
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import GlobalSymbolSelector from "@/components/workspace/GlobalSymbolSelector";
import ProviderStatus from "@/components/workspace/ProviderStatus";
import WorkspaceHeader from "@/components/workspace/WorkspaceHeader";
import WorkspaceSection from "@/components/workspace/WorkspaceSection";
import MarketRibbon from "@/components/workspace/MarketRibbon";

export default function WorkspacePage() {
  return (
    <WorkspaceProvider>
      <div className="space-y-4">
        {/* Workspace top bar: global symbol control + provider transparency */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Intelligence Workspace</p>
            <h1 className="mt-1 font-display text-2xl font-medium">AI-led market intelligence</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <GlobalSymbolSelector />
            <ProviderStatus />
          </div>
        </div>

        {/* Market Ribbon — live prices from the D2.2 service (Phase 4) */}
        <MarketRibbon />

        {/* Workspace Header — live now */}
        <WorkspaceHeader />

        {/* Supporting chart — Phase 5 (TradingView, supports the AI, never leads) */}
        <WorkspaceSection title="Chart" subtitle="Price context (supporting)" minHeight={260} pending="TradingView chart arrives in Phase 5." />

        {/* AI Intelligence — the CENTER of the workspace (Phase 6) */}
        <WorkspaceSection
          title="AI Intelligence"
          subtitle="Trend · confidence · risk · key levels · market structure"
          emphasis
          minHeight={220}
          pending="Structured Market Intelligence output arrives in Phase 6."
        />

        {/* Technical indicators + evidence — Phase 6 (real engine from D2.2) */}
        <div className="grid gap-4 lg:grid-cols-2">
          <WorkspaceSection title="Technical Indicators" subtitle="Real RSI / EMA / MACD / ATR / Bollinger" minHeight={180} pending="Wired to the real indicator engine in Phase 6." />
          <WorkspaceSection title="Evidence" subtitle="Sourced, timestamped" minHeight={180} pending="Evidence panel arrives in Phase 6." />
        </div>

        {/* Assistant + Research */}
        <div className="grid gap-4 lg:grid-cols-2">
          <WorkspaceSection title="AI Assistant" subtitle="Ask about the active symbol" minHeight={160} pending="Embedded assistant arrives later in D2.3." />
          <WorkspaceSection title="Research" subtitle="Multi-symbol & saved analyses" minHeight={160} pending="Research workspace arrives in D2.4." />
        </div>
      </div>
    </WorkspaceProvider>
  );
}
