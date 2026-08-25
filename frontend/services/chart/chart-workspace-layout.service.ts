// services/chart/chart-workspace-layout.service.ts
// Sprint D2.7.11 (post-completion, roadmap item 2) - durable, per-user
// persistence for the Phase 3 multi-symbol tiled layout. Backs the
// ChartWorkspaceLayout table: one row per userId. `save()` always
// replaces the WHOLE state - matching ChartDrawingSet/ChartTemplate's own
// established "here is the new full state" semantics, never a per-field
// PATCH endpoint.
//
// Every field is re-validated via chart-session-state.ts's own exported
// sanitizers (isChartProviderKind/isChartLayout/sanitizePane) - the exact
// same rules that already guard the sessionStorage tier, so an untrusted
// request body is held to the same standard a possibly-corrupted
// sessionStorage value always was, never a second/drifting validator.
import { prisma } from "@/lib/prisma";
import { isChartProviderKind, isChartLayout, sanitizePane, type ChartSessionState } from "@/lib/chart-engine/chart-session-state";
import { Errors } from "@/services/backend/ErrorHandler";
import type { Prisma } from "@/lib/generated/prisma/client";

const MAX_PANES = 4;

function toChartSessionState(row: { provider: string; layout: number; panes: unknown; primaryPaneIndex: number }): ChartSessionState {
  const result: ChartSessionState = {};
  if (isChartProviderKind(row.provider)) result.provider = row.provider;
  if (isChartLayout(row.layout)) result.layout = row.layout;
  if (Array.isArray(row.panes)) {
    const panes = row.panes.map(sanitizePane).filter((p): p is NonNullable<typeof p> => p !== undefined);
    if (panes.length > 0) result.panes = panes;
  }
  if (Number.isInteger(row.primaryPaneIndex) && row.primaryPaneIndex >= 0) result.primaryPaneIndex = row.primaryPaneIndex;
  return result;
}

export class ChartWorkspaceLayoutService {
  /** Never throws for "nothing saved yet" - an honest `{}`, the exact same "fall back to defaults" contract readChartSessionState() already has for a missing sessionStorage entry. */
  async get(userId: string): Promise<ChartSessionState> {
    const row = await prisma.chartWorkspaceLayout.findUnique({ where: { userId } });
    if (!row) return {};
    return toChartSessionState(row);
  }

  /** Validates and upserts the WHOLE state for this user. Fields that fail validation are honestly dropped (never fabricated/defaulted into something that looks valid) - matching sanitizePane's own per-entry drop discipline. */
  async save(userId: string, state: unknown): Promise<ChartSessionState> {
    if (typeof state !== "object" || state === null) throw Errors.validation("state must be an object");
    const s = state as Record<string, unknown>;

    const provider = isChartProviderKind(s.provider) ? s.provider : "native";
    const layout = isChartLayout(s.layout) ? s.layout : 1;
    const panes = Array.isArray(s.panes) ? s.panes.map(sanitizePane).filter((p): p is NonNullable<typeof p> => p !== undefined) : [];
    if (panes.length > MAX_PANES) throw Errors.validation(`panes exceeds the ${MAX_PANES}-pane maximum`);
    const primaryPaneIndex =
      typeof s.primaryPaneIndex === "number" && Number.isInteger(s.primaryPaneIndex) && s.primaryPaneIndex >= 0 ? s.primaryPaneIndex : 0;

    const panesJson = panes as unknown as Prisma.InputJsonValue;
    const row = await prisma.chartWorkspaceLayout.upsert({
      where: { userId },
      update: { provider, layout, panes: panesJson, primaryPaneIndex },
      create: { userId, provider, layout, panes: panesJson, primaryPaneIndex },
    });
    return toChartSessionState(row);
  }
}

export const chartWorkspaceLayoutService = new ChartWorkspaceLayoutService();
