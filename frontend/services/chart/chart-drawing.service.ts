// services/chart/chart-drawing.service.ts
// Sprint D2.7.11 Phase 1b - durable, cross-session persistence for chart
// drawn objects (trend lines, horizontal lines, rectangles, Fibonacci
// retracements). Backs the ChartDrawingSet table: one row per (userId,
// symbol, timeframe), the exact same compound key
// lib/chart-engine/drawing/store.ts's old sessionStorage entries already
// used. `save()` always replaces the WHOLE array for that key - matching
// NativeChart.tsx's own commitDrawingObjects()/write-effect semantics
// exactly (an add, a drag, and a delete are all "here is the new full set"
// from the client's point of view), never a per-object CRUD API.
//
// Every object in an incoming `objects` array is re-validated field-by-
// field via isValidDrawingObject before ever reaching the database - the
// request body is untrusted client input, same discipline store.ts always
// applied to a possibly-corrupted sessionStorage value, just now guarding
// a network boundary instead. Invalid entries are silently dropped, never
// rejected outright - matches this codebase's existing "a corrupted value
// never reaches storage, but never blocks the whole request either"
// convention (store.ts's own header comment).
import { prisma } from "@/lib/prisma";
import { isKnownMarket } from "@/lib/market-data/market-registry";
import { isSignalTimeframe } from "@/types/signal";
import { isValidDrawingObject } from "@/lib/chart-engine/drawing/validation";
import { Errors } from "@/services/backend/ErrorHandler";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { DrawingObject } from "@/lib/chart-engine/drawing/types";

const MAX_OBJECTS_PER_CHART = 200;

export class ChartDrawingService {
  async get(userId: string, symbol: string, timeframe: string): Promise<DrawingObject[]> {
    if (!isKnownMarket(symbol)) throw Errors.validation("Unknown symbol", { symbol });
    if (!isSignalTimeframe(timeframe)) throw Errors.validation("Unknown timeframe", { timeframe });

    const row = await prisma.chartDrawingSet.findUnique({
      where: { userId_symbol_timeframe: { userId, symbol, timeframe } },
    });
    if (!row) return [];
    const raw = row.objects;
    if (!Array.isArray(raw)) return [];
    return (raw as unknown[]).filter(isValidDrawingObject);
  }

  async save(userId: string, symbol: string, timeframe: string, objects: unknown): Promise<DrawingObject[]> {
    if (!isKnownMarket(symbol)) throw Errors.validation("Unknown symbol", { symbol });
    if (!isSignalTimeframe(timeframe)) throw Errors.validation("Unknown timeframe", { timeframe });
    if (!Array.isArray(objects)) throw Errors.validation("objects must be an array");

    const valid = objects.filter(isValidDrawingObject);
    if (valid.length > MAX_OBJECTS_PER_CHART) {
      throw Errors.validation(`objects exceeds the ${MAX_OBJECTS_PER_CHART}-object limit per chart`);
    }

    const objectsJson = valid as unknown as Prisma.InputJsonValue;
    const row = await prisma.chartDrawingSet.upsert({
      where: { userId_symbol_timeframe: { userId, symbol, timeframe } },
      update: { objects: objectsJson },
      create: { userId, symbol, timeframe, objects: objectsJson },
    });
    const raw = row.objects;
    return Array.isArray(raw) ? (raw as unknown[]).filter(isValidDrawingObject) : [];
  }
}

export const chartDrawingService = new ChartDrawingService();
