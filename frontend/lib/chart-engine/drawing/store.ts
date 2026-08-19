// lib/chart-engine/drawing/store.ts
// Persistence for drawn chart objects. Deliberately sessionStorage, NOT
// localStorage or a database table - the exact same choice and the exact
// same reasoning chart-session-state.ts (D2.7.5, Phase 8) already
// established for chart UI state: survive a same-tab reload or in-app
// navigation, but never silently follow the user to a new tab, a
// different device, or tomorrow's session. Durable, cross-session,
// per-account object storage (matching real MT5's own per-chart saved
// objects) is an explicit LATER phase - see the roadmap doc - not folded
// into this one without being asked for.
//
// Every read is re-validated field-by-field (never `as DrawingObject`
// trusted blindly) so a corrupted or hand-edited storage value can never
// reach the renderer as a half-formed object - it's silently dropped
// instead, matching chart-session-state.ts's own "stale value never
// applies" discipline.
import type { DrawingObject, DrawingPoint } from "./types";

const STORAGE_KEY = "at24.workspace.chart-drawings.v1";

function storeKey(symbol: string, timeframe: string): string {
  return `${symbol}|${timeframe}`;
}

function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    // Some environments (locked-down iframes, certain privacy modes) throw
    // on mere access, not just on read/write.
    return null;
  }
}

function isValidPoint(value: unknown): value is DrawingPoint {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.time === "number" && Number.isFinite(v.time) && typeof v.price === "number" && Number.isFinite(v.price);
}

function isValidObject(value: unknown): value is DrawingObject {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.color !== "string" || v.color.length === 0) return false;
  if (typeof v.createdAt !== "number" || !Number.isFinite(v.createdAt)) return false;
  if (v.tool === "horizontal-line") return typeof v.price === "number" && Number.isFinite(v.price);
  if (v.tool === "trendline" || v.tool === "rectangle" || v.tool === "fibonacci") return isValidPoint(v.p1) && isValidPoint(v.p2);
  return false;
}

function readAll(): Record<string, unknown> {
  const storage = sessionStorageOrNull();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Never throws - an absent, corrupted, or storage-unavailable entry honestly returns an empty array, exactly like a symbol/timeframe with no drawings on it yet. */
export function readDrawingObjects(symbol: string, timeframe: string): DrawingObject[] {
  const all = readAll();
  const raw = all[storeKey(symbol, timeframe)];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidObject);
}

/** Best-effort write - a full/unavailable storage never blocks or errors the chart UI, it just silently fails to persist this tick (matches chart-session-state.ts's own writeChartSessionState). */
export function writeDrawingObjects(symbol: string, timeframe: string, objects: readonly DrawingObject[]): void {
  const storage = sessionStorageOrNull();
  if (!storage) return;
  try {
    const all = readAll();
    all[storeKey(symbol, timeframe)] = objects;
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}
