"use client";

// context/WorkspaceContext.tsx
// Sprint D2.3 (Phase 2) - the single source of truth for the Intelligence
// Workspace's active symbol. The Global Symbol Selector writes here and every
// workspace panel (chart, AI intelligence, indicators, evidence, assistant,
// research) reads from here, so changing the symbol once updates the whole
// workspace. This is the foundation the D2.4 Research Engine will build on.
//
// Sprint D2.3 (Phase 7) - Workspace Profiles. Preferences (profile, favorite
// symbols, collapsed panels, chart interval) are loaded once on mount from
// GET /api/private/workspace/preferences and hydrated in - the same
// "loading -> ready" swap IntelligencePanel already does for analysis data,
// not a new pattern on this page. Every setter here updates local state
// immediately (instant, no reload) and fires a background PATCH to persist
// it; failures are logged, never blocking the UI - this is presentation
// preference data, not anything the AI pipeline depends on.
//
// Hard rule: setProfile NEVER touches `symbol`. A user mid-analysis on Gold
// must not have their active symbol silently swapped just because they
// switched from Investor to Scalper. Profile only ever changes chartInterval
// (and, via panels, layout) - never the active symbol, never anything
// AI-related.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getMarket, isKnownMarket, listEnabledMarkets } from "@/lib/market-data/market-registry";
import type { MarketCategory } from "@/types/market";
import {
  PROFILE_INTERVAL,
  type PanelId,
  type WorkspacePreferencesData,
  type WorkspacePreferencesPatch,
  type WorkspaceProfile,
} from "@/types/workspace-preferences";

const DEFAULT_SYMBOL = listEnabledMarkets()[0]?.symbol ?? "EURUSD";
const PREFERENCES_ENDPOINT = "/api/private/workspace/preferences";

function persist(patch: WorkspacePreferencesPatch): void {
  fetch(PREFERENCES_ENDPOINT, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).catch((err) => {
    console.error("Failed to persist workspace preference", err);
  });
}

export interface WorkspaceContextValue {
  symbol: string;
  setSymbol: (symbol: string) => void;
  /** Human name of the active symbol from the registry, when known. */
  name?: string;
  /** Asset class of the active symbol - drives the "Workspace: Forex" label until full profiles (Phase 7). */
  assetClass?: MarketCategory;

  profile: WorkspaceProfile;
  /** Sets the workspace profile and its default chart interval. Never touches `symbol`. */
  setProfile: (profile: WorkspaceProfile) => void;
  chartInterval: string;

  favorites: string[];
  toggleFavorite: (symbol: string) => void;
  reorderFavorite: (symbol: string, direction: "up" | "down") => void;

  collapsedPanels: PanelId[];
  togglePanel: (id: PanelId) => void;

  preferencesLoaded: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children, initialSymbol }: { children: ReactNode; initialSymbol?: string }) {
  const [symbol, setSymbolState] = useState<string>(initialSymbol ?? DEFAULT_SYMBOL);
  const [profile, setProfileState] = useState<WorkspaceProfile>("default");
  const [chartInterval, setChartInterval] = useState<string>(PROFILE_INTERVAL.default);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [collapsedPanels, setCollapsedPanels] = useState<PanelId[]>([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const symbolExplicitlySet = useRef(false);

  useEffect(() => {
    let active = true;
    fetch(PREFERENCES_ENDPOINT)
      .then((r) => r.json())
      .then((j) => {
        if (!active || j?.status !== "ok") return;
        const data = j.data as WorkspacePreferencesData;
        // A user-initiated symbol change that lands before this fetch resolves wins - never overwrite it.
        if (!symbolExplicitlySet.current && data.symbol && isKnownMarket(data.symbol)) {
          setSymbolState(data.symbol);
        }
        setProfileState(data.profile);
        setChartInterval(data.chartInterval);
        setFavorites(data.favoriteMarkets);
        setCollapsedPanels(data.collapsedPanels);
      })
      .catch((err) => console.error("Failed to load workspace preferences", err))
      .finally(() => {
        if (active) setPreferencesLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const setSymbol = (next: string) => {
    symbolExplicitlySet.current = true;
    setSymbolState(next);
    persist({ symbol: next });
  };

  const setProfile = (next: WorkspaceProfile) => {
    const interval = PROFILE_INTERVAL[next];
    setProfileState(next);
    setChartInterval(interval);
    persist({ profile: next, chartInterval: interval });
  };

  const toggleFavorite = (target: string) => {
    setFavorites((prev) => {
      const next = prev.includes(target) ? prev.filter((s) => s !== target) : [...prev, target];
      persist({ favoriteMarkets: next });
      return next;
    });
  };

  const reorderFavorite = (target: string, direction: "up" | "down") => {
    setFavorites((prev) => {
      const index = prev.indexOf(target);
      if (index === -1) return prev;
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      persist({ favoriteMarkets: next });
      return next;
    });
  };

  const togglePanel = (id: PanelId) => {
    setCollapsedPanels((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      persist({ collapsedPanels: next });
      return next;
    });
  };

  const value = useMemo<WorkspaceContextValue>(() => {
    const market = getMarket(symbol);
    return {
      symbol,
      setSymbol,
      name: market?.name,
      assetClass: market?.assetClass,
      profile,
      setProfile,
      chartInterval,
      favorites,
      toggleFavorite,
      reorderFavorite,
      collapsedPanels,
      togglePanel,
      preferencesLoaded,
    };
  }, [symbol, profile, chartInterval, favorites, collapsedPanels, preferencesLoaded]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
