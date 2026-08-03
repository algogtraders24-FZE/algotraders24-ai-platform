"use client";

// app/dashboard/workspace/page.tsx
// Sprint D2.3 - the Intelligence Workspace. A new, dedicated route (existing
// module pages are untouched). Final layout order:
//   Market Ribbon (P4) → Workspace Header → TradingView Chart (P5) →
//   AI Intelligence (P6, the CENTER) → Assistant → Research (D2.4).
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
import AdvancedChart from "@/components/workspace/tradingview/AdvancedChart";
import IntelligencePanel from "@/components/workspace/IntelligencePanel";
import ProfileSwitcher from "@/components/workspace/ProfileSwitcher";
import FavoriteMarkets from "@/components/workspace/FavoriteMarkets";

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

        {/* Workspace Profiles + Favorites (Phase 7) — presentation-only personalization:
            profile changes only the chart's display interval, never the active symbol. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ProfileSwitcher />
          <FavoriteMarkets />
        </div>

        {/* Market Ribbon — live prices from the D2.2 service (Phase 4) */}
        <MarketRibbon />

        {/* Workspace Header — live now */}
        <WorkspaceHeader />

        {/* Supporting chart — TradingView (visualization only; supports the AI, never leads) */}
        <WorkspaceSection
          id="chart"
          collapsible
          title="Chart"
          subtitle="Price context — a supporting visualization, not the headline"
        >
          <AdvancedChart />
        </WorkspaceSection>

        {/* AI Intelligence — the CENTER of the workspace (Phase 6). One unified
            panel: market status, confidence, risk, structure, key levels,
            evidence and timestamp all live here, sourced from the real D2.2
            pipeline — no separate "Technical Indicators" / "Evidence" panels,
            to keep the acceptance rule "zero duplicated intelligence". */}
        <WorkspaceSection
          title="AI Intelligence"
          subtitle="Trend · confidence · risk · key levels · market structure"
          emphasis
        >
          <IntelligencePanel />
        </WorkspaceSection>

        {/* Assistant + Research */}
        <div className="grid gap-4 lg:grid-cols-2">
          <WorkspaceSection
            id="assistant"
            collapsible
            title="AI Assistant"
            subtitle="Ask about the active symbol"
            minHeight={160}
            pending="Embedded assistant arrives later in D2.3."
          />
          <WorkspaceSection
            id="research"
            collapsible
            title="Research"
            subtitle="Multi-symbol & saved analyses"
            minHeight={160}
            pending="Research workspace arrives in D2.4."
          />
        </div>
      </div>
    </WorkspaceProvider>
  );
}
