// lib/chart-engine/templates/store.ts
// Sprint D2.7.11 Phase 4 - thin async fetch wrappers around
// GET/POST /api/private/chart-templates and DELETE
// /api/private/chart-templates/:id, mirroring lib/chart-engine/drawing/
// store.ts's own contract: never throws, an unauthenticated caller or a
// network failure honestly resolves to an empty list / undefined rather
// than a fabricated result.
import type { ChartTemplate } from "./types";
import type { DrawingObject } from "../drawing/types";

export async function listTemplates(): Promise<ChartTemplate[]> {
  try {
    const res = await fetch("/api/private/chart-templates");
    if (!res.ok) return [];
    const json = await res.json();
    const templates = json?.data?.templates;
    return Array.isArray(templates) ? (templates as ChartTemplate[]) : [];
  } catch {
    return [];
  }
}

/** Upserts by name - saving under an existing template's name overwrites it. Returns undefined on failure (network error, validation rejection) so the caller can show an honest "save failed" state rather than assuming success. */
export async function saveTemplate(name: string, indicatorKeys: readonly string[], drawingObjects: readonly DrawingObject[]): Promise<ChartTemplate | undefined> {
  try {
    const res = await fetch("/api/private/chart-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, indicatorKeys, drawingObjects }),
    });
    if (!res.ok) return undefined;
    const json = await res.json();
    return json?.data?.template as ChartTemplate | undefined;
  } catch {
    return undefined;
  }
}

export async function deleteTemplate(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/private/chart-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}
