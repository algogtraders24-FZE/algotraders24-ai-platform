"use client";

// context/PaperTradingContext.tsx
// Paper Trading Engine, Phase P1. Deliberately NOT folded into
// WorkspaceContext - WorkspacePreference is explicitly a flat one-row-per-
// user shape with no per-symbol dimension, while a paper account has its
// own multi-row shape (an account + a list of positions) closer to
// ChartWorkspaceLayout territory. Fetched once on mount and hydrated in -
// the same "loading -> ready" swap WorkspaceContext's own preferences
// fetch already uses, never a useState initializer (would break SSR
// hydration). Mutations (open/close/reset) call the store, then refetch
// the whole account - this is discrete-mutation state, not continuous, so
// a full refetch after each action is simpler and safer than hand-patching
// local state to match a server-computed margin/balance change.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchAccount, openPosition as openPositionRequest, closePosition as closePositionRequest, resetAccount as resetAccountRequest } from "@/lib/paper-trading/store";
import type { PaperAccountSummary, OpenPositionInput } from "@/types/paper-trading";

export interface PaperTradingContextValue {
  account: PaperAccountSummary | undefined;
  loaded: boolean;
  refetch: () => Promise<void>;
  openPosition: (input: OpenPositionInput) => Promise<void>;
  closePosition: (id: string) => Promise<void>;
  reset: () => Promise<void>;
}

const PaperTradingContext = createContext<PaperTradingContextValue | null>(null);

export function PaperTradingProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<PaperAccountSummary | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    const summary = await fetchAccount();
    setAccount(summary);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const openPosition = useCallback(
    async (input: OpenPositionInput) => {
      await openPositionRequest(input);
      await refetch();
    },
    [refetch],
  );

  const closePosition = useCallback(
    async (id: string) => {
      await closePositionRequest(id);
      await refetch();
    },
    [refetch],
  );

  const reset = useCallback(async () => {
    const summary = await resetAccountRequest();
    setAccount(summary);
  }, []);

  return (
    <PaperTradingContext.Provider value={{ account, loaded, refetch, openPosition, closePosition, reset }}>
      {children}
    </PaperTradingContext.Provider>
  );
}

export function usePaperTrading(): PaperTradingContextValue {
  const ctx = useContext(PaperTradingContext);
  if (!ctx) throw new Error("usePaperTrading must be used within a PaperTradingProvider");
  return ctx;
}
