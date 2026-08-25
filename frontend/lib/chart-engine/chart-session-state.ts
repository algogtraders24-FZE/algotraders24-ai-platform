// lib/chart-engine/chart-session-state.ts
// Sprint D2.7.5, Phase 8 - Chart State Persistence. Originally a
// sessionStorage-backed tier (see git history for that implementation) -
// a user's chosen chart provider/timeframe/indicators survived a same-tab
// reload but never followed them to a new tab/device. Every value was
// re-validated against the SAME real registries the rest of the chart
// engine trusts (SignalTimeframe, DEFAULT_INDICATOR_CONFIGS,
// ChartProviderKind) so a stale or hand-edited storage value could never
// apply an unknown timeframe/indicator/provider - it was silently dropped
// instead. That validation discipline is the part that survives below.
//
// Sprint D2.7.11 Phase 3 - multi-symbol tiled layout. `panes` replaced the
// old single flat {timeframe, indicatorKeys} shape: one entry per visible
// grid cell (front-truncated/grown to match `layout` - see ChartPanel.tsx's
// own comment for why array length always equals the active layout count,
// never a separately-tracked "which panes exist" list). `primaryPaneIndex`
// is a plain array index, not a pane id - ids are regenerated fresh on
// every page load (ChartPanel.tsx creates them via crypto.randomUUID()),
// so persisting one across a reload would never match anything real; the
// INDEX is what's meaningful and stable to restore.
//
// Sprint D2.7.11 (post-completion, roadmap item 2) - promoted to a real
// durable per-user database table (ChartWorkspaceLayout, via
// chart-workspace-layout.service.ts / chart-workspace-layout-store.ts),
// the exact Phase 1 -> 1b precedent this same roadmap already established
// for drawn objects (prove it in session storage first, earn a real table
// once the feature is settled). This file's own sessionStorage I/O is
// therefore RETIRED - genuinely deleted, not left as dead code - only the
// shape (ChartSessionState/ChartPaneSessionState/ChartLayout) and its
// validation rules survive, since both the client store and the new
// server-side service need the exact same "never trust an untrusted
// value" sanitizers, at two different network boundaries now instead of
// one storage boundary.
import { isSignalTimeframe, type SignalTimeframe } from "@/types/signal";
import { DEFAULT_INDICATOR_CONFIGS } from "./indicators/panel-registry";
import type { ChartProviderKind } from "@/types/chart-data";

export type ChartLayout = 1 | 2 | 4;

export interface ChartPaneSessionState {
  symbol: string;
  timeframe: SignalTimeframe;
  indicatorKeys: string[];
}

export interface ChartSessionState {
  provider?: ChartProviderKind;
  layout?: ChartLayout;
  panes?: ChartPaneSessionState[];
  primaryPaneIndex?: number;
}

/** Shared by chart-workspace-layout-store.ts (client) and chart-workspace-layout.service.ts (server) - the one canonical validator for this shape, never a second/drifting one at either boundary. */
export function isChartProviderKind(value: unknown): value is ChartProviderKind {
  return value === "native" || value === "tradingview";
}

export function isChartLayout(value: unknown): value is ChartLayout {
  return value === 1 || value === 2 || value === 4;
}

export function sanitizePane(value: unknown): ChartPaneSessionState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.symbol !== "string" || v.symbol.length === 0) return undefined;
  if (!isSignalTimeframe(v.timeframe)) return undefined;
  const known = new Set(DEFAULT_INDICATOR_CONFIGS.map((cfg) => cfg.key));
  const indicatorKeys = Array.isArray(v.indicatorKeys) ? v.indicatorKeys.filter((key): key is string => typeof key === "string" && known.has(key)) : [];
  return { symbol: v.symbol, timeframe: v.timeframe, indicatorKeys };
}
