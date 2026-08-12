"use client";

// app/dashboard/workspace/page.tsx
// Sprint D2.3 - the Intelligence Workspace. A new, dedicated route (existing
// module pages are untouched). Final layout order:
//   Market Ribbon (P4) → Workspace Header → TradingView Chart (P5) →
//   AI Intelligence (P6, the CENTER) → Assistant → Research.
// Positioning is enforced structurally: the AI Intelligence panel carries the
// `emphasis` treatment; the chart is a supporting panel above it, never the
// headline. The Global Symbol Selector drives every panel through
// WorkspaceContext.
//
// Sprint D2.6.11 - the AI Assistant and Research sections previously
// rendered the stale D2.3/D2.4 "arrives later" placeholders (WorkspaceSection
// `pending` text) - both are now wired to real, already-verified
// intelligence: WorkspaceAssistant reuses the D2.6.5-D2.6.10 chat-facing
// pipeline scoped to the active symbol, WorkspaceResearch reuses the same
// VerifiedAnswerResponse/VerifiedAIAnswerCard contract as a read-only
// snapshot. No production sprint-number text remains in this page.
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import GlobalSymbolSelector from "@/components/workspace/GlobalSymbolSelector";
import ProviderStatus from "@/components/workspace/ProviderStatus";
import WorkspaceHeader from "@/components/workspace/WorkspaceHeader";
import WorkspaceSection from "@/components/workspace/WorkspaceSection";
import MarketRibbon from "@/components/workspace/MarketRibbon";
import ChartPanel from "@/components/chart-engine/ChartPanel";
import IntelligencePanel from "@/components/workspace/IntelligencePanel";
import ProfileSwitcher from "@/components/workspace/ProfileSwitcher";
import FavoriteMarkets from "@/components/workspace/FavoriteMarkets";
import WorkspaceAssistant from "@/components/workspace/WorkspaceAssistant";
import WorkspaceResearch from "@/components/workspace/WorkspaceResearch";

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

        {/* Supporting chart — TradingView by default, or AT24's own native
            engine (Sprint D2.7.2) via the explicit provider toggle inside
            ChartPanel. Visualization only; supports the AI, never leads. */}
        <WorkspaceSection
          id="chart"
          collapsible
          title="Chart"
          subtitle="Price context — a supporting visualization, not the headline"
        >
          <ChartPanel />
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
          <WorkspaceSection id="assistant" collapsible title="AI Assistant" subtitle="Ask about the active symbol" minHeight={160}>
            <WorkspaceAssistant />
          </WorkspaceSection>
          <WorkspaceSection id="research" collapsible title="Research" subtitle="Current market state & intelligence for the active symbol" minHeight={160}>
            <WorkspaceResearch />
          </WorkspaceSection>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
