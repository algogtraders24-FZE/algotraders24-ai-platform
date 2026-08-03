"use client";

// context/WorkspaceContext.tsx
// Sprint D2.3 (Phase 2) - the single source of truth for the Intelligence
// Workspace's active symbol. The Global Symbol Selector writes here and every
// workspace panel (chart, AI intelligence, indicators, evidence, assistant,
// research) reads from here, so changing the symbol once updates the whole
// workspace. This is the foundation the D2.4 Research Engine will build on.
// UI state only - no data fetching, no persistence changes.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { getMarket, listEnabledMarkets } from "@/lib/market-data/market-registry";
import type { MarketCategory } from "@/types/market";

const DEFAULT_SYMBOL = listEnabledMarkets()[0]?.symbol ?? "EURUSD";

export interface WorkspaceContextValue {
  symbol: string;
  setSymbol: (symbol: string) => void;
  /** Human name of the active symbol from the registry, when known. */
  name?: string;
  /** Asset class of the active symbol - drives the "Workspace: Forex" label until full profiles (Phase 7). */
  assetClass?: MarketCategory;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children, initialSymbol }: { children: ReactNode; initialSymbol?: string }) {
  const [symbol, setSymbol] = useState<string>(initialSymbol ?? DEFAULT_SYMBOL);

  const value = useMemo<WorkspaceContextValue>(() => {
    const market = getMarket(symbol);
    return { symbol, setSymbol, name: market?.name, assetClass: market?.assetClass };
  }, [symbol]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
