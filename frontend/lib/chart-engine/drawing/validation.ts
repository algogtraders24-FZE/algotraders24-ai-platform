// lib/chart-engine/drawing/validation.ts
// Sprint D2.7.11 Phase 1b - the ONE field-by-field DrawingObject validator,
// shared by the client (store.ts, validating a network response) and the
// server (services/chart/chart-drawing.service.ts, validating an untrusted
// request body before it ever reaches the database). Previously this logic
// lived only in store.ts, guarding a corrupted/hand-edited sessionStorage
// value - now it guards two genuinely different untrusted inputs with the
// exact same rules, never a second, potentially-drifting copy.
import type { DrawingObject, DrawingPoint } from "./types";

export function isValidDrawingPoint(value: unknown): value is DrawingPoint {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.time === "number" && Number.isFinite(v.time) && typeof v.price === "number" && Number.isFinite(v.price);
}

export function isValidDrawingObject(value: unknown): value is DrawingObject {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.color !== "string" || v.color.length === 0) return false;
  if (typeof v.createdAt !== "number" || !Number.isFinite(v.createdAt)) return false;
  if (v.tool === "horizontal-line") return typeof v.price === "number" && Number.isFinite(v.price);
  if (v.tool === "trendline" || v.tool === "rectangle" || v.tool === "fibonacci") return isValidDrawingPoint(v.p1) && isValidDrawingPoint(v.p2);
  return false;
}
