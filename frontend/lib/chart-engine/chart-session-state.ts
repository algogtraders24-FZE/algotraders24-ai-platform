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
import { isSignalTimeframe, type SignalTimeframe } from "@/types/signal";
import { DEFAULT_INDICATOR_CONFIGS } from "./indicators/panel-registry";
import type { ChartProviderKind } from "@/types/chart-data";

const STORAGE_KEY = "at24.workspace.chart-session.v1";

export interface ChartSessionState {
  provider?: ChartProviderKind;
  timeframe?: SignalTimeframe;
  indicatorKeys?: string[];
}

function isChartProviderKind(value: unknown): value is ChartProviderKind {
  return value === "native" || value === "tradingview";
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
 * "fall back to the existing hardcoded default", not a special case.
 */
export function readChartSessionState(): ChartSessionState {
  const storage = sessionStorageOrNull();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<keyof ChartSessionState, unknown>>;
    const result: ChartSessionState = {};
    if (isChartProviderKind(parsed.provider)) result.provider = parsed.provider;
    if (isSignalTimeframe(parsed.timeframe)) result.timeframe = parsed.timeframe;
    if (Array.isArray(parsed.indicatorKeys)) {
      const known = new Set(DEFAULT_INDICATOR_CONFIGS.map((cfg) => cfg.key));
      result.indicatorKeys = parsed.indicatorKeys.filter((key): key is string => typeof key === "string" && known.has(key));
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
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}
