// services/workspace/workspace-preferences.service.ts
// Sprint D2.3 (Phase 7) - Workspace Profiles persistence. Presentation layer
// only: reads/writes the one-row-per-user WorkspacePreference table and
// validates every field against known-good values (registry symbols, the
// fixed profile/panel enums) before it ever reaches the database. Never
// touches services/ai/* or services/market-data/* - a profile, favorite
// list, or panel-collapse change can never change what the AI Intelligence
// pipeline computes for a symbol.
import { prisma } from "@/lib/prisma";
import { isKnownMarket } from "@/lib/market-data/market-registry";
import { Errors } from "@/services/backend/ErrorHandler";
import {
  isWorkspaceProfile,
  isPanelId,
  type WorkspacePreferencesData,
  type WorkspacePreferencesPatch,
} from "@/types/workspace-preferences";

const MAX_FAVORITES = 20;

function toData(row: {
  profile: string;
  symbol: string | null;
  chartInterval: string;
  favoriteMarkets: string[];
  collapsedPanels: string[];
  sidebarCollapsed: boolean;
  theme: string;
}): WorkspacePreferencesData {
  return {
    profile: isWorkspaceProfile(row.profile) ? row.profile : "default",
    symbol: row.symbol,
    chartInterval: row.chartInterval,
    favoriteMarkets: row.favoriteMarkets,
    collapsedPanels: row.collapsedPanels.filter(isPanelId),
    sidebarCollapsed: row.sidebarCollapsed,
    theme: row.theme,
  };
}

export class WorkspacePreferencesService {
  async getOrCreate(userId: string): Promise<WorkspacePreferencesData> {
    const row = await prisma.workspacePreference.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    return toData(row);
  }

  async update(userId: string, patch: WorkspacePreferencesPatch): Promise<WorkspacePreferencesData> {
    if (patch.profile !== undefined && !isWorkspaceProfile(patch.profile)) {
      throw Errors.validation("Unknown workspace profile", { profile: patch.profile });
    }
    if (patch.symbol !== undefined && !isKnownMarket(patch.symbol)) {
      throw Errors.validation("Unknown symbol", { symbol: patch.symbol });
    }
    if (patch.favoriteMarkets !== undefined) {
      const unknown = patch.favoriteMarkets.find((s) => !isKnownMarket(s));
      if (unknown) throw Errors.validation("Unknown symbol in favoriteMarkets", { symbol: unknown });
      if (patch.favoriteMarkets.length > MAX_FAVORITES) {
        throw Errors.validation(`favoriteMarkets exceeds the ${MAX_FAVORITES}-symbol limit`);
      }
    }
    if (patch.collapsedPanels !== undefined) {
      const unknown = patch.collapsedPanels.find((p) => !isPanelId(p));
      if (unknown) throw Errors.validation("Unknown panel id in collapsedPanels", { panel: unknown });
    }
    if (patch.chartInterval !== undefined && typeof patch.chartInterval !== "string") {
      throw Errors.validation("chartInterval must be a string");
    }

    const row = await prisma.workspacePreference.upsert({
      where: { userId },
      update: { ...patch },
      create: { userId, ...patch },
    });
    return toData(row);
  }
}

export const workspacePreferencesService = new WorkspacePreferencesService();
