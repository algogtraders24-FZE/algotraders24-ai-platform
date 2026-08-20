// services/chart/chart-template.service.ts
// Sprint D2.7.11 Phase 4 - saved chart templates (MT5's own real Template
// feature): a named, reusable bundle of active indicators + drawn objects,
// applicable to any symbol/timeframe (unlike ChartDrawingSet, which is
// scoped to one). Backs the ChartTemplate table: one row per (userId,
// name) - saving under an existing name is a deliberate upsert
// (overwrite), matching how "Save Template" behaves in most real apps
// including MT5 itself, never a rejected duplicate.
//
// `indicatorKeys` is validated against DEFAULT_INDICATOR_CONFIGS (the one
// canonical indicator registry - never a second list here) and
// `drawingObjects` against isValidDrawingObject, both re-checked
// field-by-field on every read AND write - the exact same "untrusted
// network input, corrupted values silently dropped rather than trusted or
// rejecting the whole request" discipline chart-drawing.service.ts
// already established.
import { prisma } from "@/lib/prisma";
import { DEFAULT_INDICATOR_CONFIGS } from "@/lib/chart-engine/indicators/panel-registry";
import { isValidDrawingObject } from "@/lib/chart-engine/drawing/validation";
import { Errors } from "@/services/backend/ErrorHandler";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { DrawingObject } from "@/lib/chart-engine/drawing/types";

const MAX_TEMPLATES_PER_USER = 50;
const MAX_TEMPLATE_NAME_LENGTH = 60;
const KNOWN_INDICATOR_KEYS = new Set(DEFAULT_INDICATOR_CONFIGS.map((cfg) => cfg.key));

export interface ChartTemplateData {
  id: string;
  name: string;
  indicatorKeys: string[];
  drawingObjects: DrawingObject[];
  updatedAt: string;
}

function toData(row: { id: string; name: string; indicatorKeys: string[]; drawingObjects: unknown; updatedAt: Date }): ChartTemplateData {
  const rawObjects = row.drawingObjects;
  return {
    id: row.id,
    name: row.name,
    indicatorKeys: row.indicatorKeys.filter((k) => KNOWN_INDICATOR_KEYS.has(k)),
    drawingObjects: Array.isArray(rawObjects) ? (rawObjects as unknown[]).filter(isValidDrawingObject) : [],
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ChartTemplateService {
  async list(userId: string): Promise<ChartTemplateData[]> {
    const rows = await prisma.chartTemplate.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
    return rows.map(toData);
  }

  async save(userId: string, name: unknown, indicatorKeys: unknown, drawingObjects: unknown): Promise<ChartTemplateData> {
    if (typeof name !== "string" || name.trim().length === 0) throw Errors.validation("name is required");
    const trimmedName = name.trim();
    if (trimmedName.length > MAX_TEMPLATE_NAME_LENGTH) {
      throw Errors.validation(`name exceeds the ${MAX_TEMPLATE_NAME_LENGTH}-character limit`);
    }
    if (!Array.isArray(indicatorKeys)) throw Errors.validation("indicatorKeys must be an array");
    if (!Array.isArray(drawingObjects)) throw Errors.validation("drawingObjects must be an array");

    const validKeys = [...new Set(indicatorKeys.filter((k): k is string => typeof k === "string" && KNOWN_INDICATOR_KEYS.has(k)))];
    const validObjects = drawingObjects.filter(isValidDrawingObject);

    const existing = await prisma.chartTemplate.findUnique({ where: { userId_name: { userId, name: trimmedName } } });
    if (!existing) {
      const count = await prisma.chartTemplate.count({ where: { userId } });
      if (count >= MAX_TEMPLATES_PER_USER) {
        throw Errors.validation(`you already have ${MAX_TEMPLATES_PER_USER} saved templates - delete one before saving another`);
      }
    }

    const row = await prisma.chartTemplate.upsert({
      where: { userId_name: { userId, name: trimmedName } },
      update: { indicatorKeys: validKeys, drawingObjects: validObjects as unknown as Prisma.InputJsonValue },
      create: { userId, name: trimmedName, indicatorKeys: validKeys, drawingObjects: validObjects as unknown as Prisma.InputJsonValue },
    });
    return toData(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    // Ownership scoped directly in the query (never a separate fetch-then-
    // check) - a template belonging to another user is indistinguishable
    // from a nonexistent one, matching this codebase's own established
    // "404, never 403" pattern for owned resources.
    const result = await prisma.chartTemplate.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw Errors.notFound("Chart template", { id });
  }
}

export const chartTemplateService = new ChartTemplateService();
