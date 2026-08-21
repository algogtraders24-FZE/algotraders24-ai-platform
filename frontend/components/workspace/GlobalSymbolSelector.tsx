"use client";

// components/workspace/GlobalSymbolSelector.tsx
// Sprint D2.3 (Phase 2) - Addition 2. The single symbol control for the whole
// workspace: changing it updates every panel (chart, AI intelligence,
// indicators, evidence, assistant, research) because they all read the shared
// WorkspaceContext.
//
// Sprint D2.6.3 - functional upgrade only (not a redesign, per the sprint's
// own instruction): the fixed <select> over 10 registry-enabled symbols is
// replaced with a real search box over GET /api/instruments/search, so a
// trader can type "BTC", "Bitcoin", "Gold", "NIFTY", or a provider symbol
// like "BTCUSDT" and get real, ranked, provider-labeled candidates - never
// a fabricated or arbitrarily-picked match. Selecting a result still just
// calls the same WorkspaceContext.setSymbol() every other part of the app
// already relies on; nothing about that contract changes.
//
// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. The same route now also searches live provider discovery when
// the pre-existing catalog alone doesn't answer a query well (see
// UniversalInstrumentDiscoveryService) - this component has NO knowledge
// of that; it only renders whatever the route returns, honoring "never
// hardcode search results into the component."
//
// Sprint D2.7.11 Phase 3 - the actual search/keyboard-nav/discovery
// implementation moved to InstrumentSearchBox.tsx so a chart pane's own
// independent symbol search (multi-symbol tiled layout) can reuse it
// instead of a second, drifting copy. This component is now just that box
// wired to WorkspaceContext - the ONE place `useWorkspace()` is read for
// the page-level symbol control, unchanged in behavior.
import { useWorkspace } from "@/context/WorkspaceContext";
import InstrumentSearchBox from "./InstrumentSearchBox";

export default function GlobalSymbolSelector() {
  const { symbol, setSymbol } = useWorkspace();
  return (
    <div className="relative inline-flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wider text-text-3">Symbol</span>
      <InstrumentSearchBox value={symbol} onChange={setSymbol} />
    </div>
  );
}
