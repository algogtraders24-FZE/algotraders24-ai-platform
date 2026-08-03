// types/workspace-preferences.ts
// Sprint D2.3 (Phase 7) - Workspace Profiles. Presentation-only preference
// shapes: profile choice, favorite symbols, panel collapse state, and the
// TradingView chart's own display interval. None of this feeds the AI
// Intelligence pipeline (services/ai/trading-copilot.service.ts takes no
// input from here) - see services/workspace/workspace-preferences.service.ts
// for the read/write logic and validation.

export type WorkspaceProfile = "default" | "scalper" | "day_trader" | "swing_trader" | "investor";

export const WORKSPACE_PROFILES: readonly WorkspaceProfile[] = [
  "default",
  "scalper",
  "day_trader",
  "swing_trader",
  "investor",
];

export function isWorkspaceProfile(value: unknown): value is WorkspaceProfile {
  return typeof value === "string" && (WORKSPACE_PROFILES as readonly string[]).includes(value);
}

// The TradingView widget's own interval codes (see AdvancedChart.tsx) - a
// pure display preference, never a parameter to any analysis pipeline.
export const PROFILE_INTERVAL: Record<WorkspaceProfile, string> = {
  default: "D",
  scalper: "5",
  day_trader: "15",
  swing_trader: "240",
  investor: "W",
};

// Collapsible workspace panels. The AI Intelligence panel is deliberately
// excluded - it must always stay visible as the workspace's primary
// decision surface.
export const PANEL_IDS = ["chart", "assistant", "research"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export function isPanelId(value: unknown): value is PanelId {
  return typeof value === "string" && (PANEL_IDS as readonly string[]).includes(value);
}

export interface WorkspacePreferencesData {
  profile: WorkspaceProfile;
  symbol: string | null;
  chartInterval: string;
  favoriteMarkets: string[];
  collapsedPanels: PanelId[];
  sidebarCollapsed: boolean;
  theme: string;
}

export interface WorkspacePreferencesPatch {
  profile?: WorkspaceProfile;
  symbol?: string;
  chartInterval?: string;
  favoriteMarkets?: string[];
  collapsedPanels?: PanelId[];
}
