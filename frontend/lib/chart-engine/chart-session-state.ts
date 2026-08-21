// lib/chart-engine/chart-session-state.ts
// Sprint D2.7.5, Phase 8 - Chart State Persistence. The brief explicitly
// forbids a new database persistence layer here (WorkspacePreferences,
// D2.3-P7, already owns the durable, cross-session/cross-device symbol +
// profile + favorites + collapsed-panel state - this is deliberately NOT
// that) and asks to avoid localStorage without a clear reason. sessionStorage
// is the one mechanism that matches the brief's own word choice exactly: a
// user's chosen chart provider/timeframe/indicators should survive a
// same-tab reload or an in-app navigation away from and back to the
// Workspace, but should NOT silently follow them to a new browser tab, a
// different device, or tomorrow's session - that would be a durable
// preference, which is WorkspacePreferences' job, not this one. Every read
// is re-validated against the SAME real registries the rest of the chart
// engine trusts (SignalTimeframe, DEFAULT_INDICATOR_CONFIGS, ChartProviderKind)
// so a stale or hand-edited storage value can never apply an unknown
// timeframe/indicator/provider - it is silently dropped instead.
//
// Sprint D2.7.11 Phase 3 - multi-symbol tiled layout. `panes` replaces the
// old single flat {timeframe, indicatorKeys} shape: one entry per visible
// grid cell (front-truncated/grown to match `layout` - see ChartPanel.tsx's
// own comment for why array length always equals the active layout count,
// never a separately-tracked "which panes exist" list). `primaryPaneIndex`
// is a plain array index, not a pane id - ids are regenerated fresh on
// every page load (ChartPanel.tsx creates them via crypto.randomUUID()),
// so persisting one across a reload would never match anything real; the
// INDEX is what's meaningful and stable to restore. Deliberately still
// session-scoped, not durable - the same "prove it in session storage
// first" precedent this file's own drawn-object sessionStorage tier
// followed before Phase 1b earned it a real database table.
import { isSignalTimeframe, type SignalTimeframe } from "@/types/signal";
import { DEFAULT_INDICATOR_CONFIGS } from "./indicators/panel-registry";
import type { ChartProviderKind } from "@/types/chart-data";

export const CHART_SESSION_STORAGE_KEY = "at24.workspace.chart-session.v2";

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

function isChartProviderKind(value: unknown): value is ChartProviderKind {
  return value === "native" || value === "tradingview";
}

function isChartLayout(value: unknown): value is ChartLayout {
  return value === 1 || value === 2 || value === 4;
}

function sanitizePane(value: unknown): ChartPaneSessionState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.symbol !== "string" || v.symbol.length === 0) return undefined;
  if (!isSignalTimeframe(v.timeframe)) return undefined;
  const known = new Set(DEFAULT_INDICATOR_CONFIGS.map((cfg) => cfg.key));
  const indicatorKeys = Array.isArray(v.indicatorKeys) ? v.indicatorKeys.filter((key): key is string => typeof key === "string" && known.has(key)) : [];
  return { symbol: v.symbol, timeframe: v.timeframe, indicatorKeys };
}

function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    // Some environments (locked-down iframes, certain privacy modes) throw
    // on mere access, not just on read/write - never let that crash the chart.
    return null;
  }
}

/**
 * Reads and validates this tab's persisted chart UI state. Never throws -
 * an absent, corrupted, or storage-unavailable state honestly returns `{}`
 * (every field simply undefined), which every caller already treats as
 * "fall back to the existing hardcoded default", not a special case. A
 * `panes` entry that fails validation is dropped from the array rather
 * than failing the whole read, matching every other sanitizer in this
 * codebase's "corrupted value silently dropped, never trusted" rule.
 */
export function readChartSessionState(): ChartSessionState {
  const storage = sessionStorageOrNull();
  if (!storage) return {};
  try {
    const raw = storage.getItem(CHART_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<keyof ChartSessionState, unknown>>;
    const result: ChartSessionState = {};
    if (isChartProviderKind(parsed.provider)) result.provider = parsed.provider;
    if (isChartLayout(parsed.layout)) result.layout = parsed.layout;
    if (Array.isArray(parsed.panes)) {
      const panes = parsed.panes.map(sanitizePane).filter((p): p is ChartPaneSessionState => p !== undefined);
      if (panes.length > 0) result.panes = panes;
    }
    if (typeof parsed.primaryPaneIndex === "number" && Number.isInteger(parsed.primaryPaneIndex) && parsed.primaryPaneIndex >= 0) {
      result.primaryPaneIndex = parsed.primaryPaneIndex;
    }
    return result;
  } catch {
    return {};
  }
}

/** Best-effort write - a full/unavailable storage (e.g. private browsing quota) never blocks or errors the chart UI, it just silently fails to persist this tick. */
export function writeChartSessionState(state: ChartSessionState): void {
  const storage = sessionStorageOrNull();
  if (!storage) return;
  try {
    storage.setItem(CHART_SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}
