// app/dashboard/signals/page.tsx
"use client";

// Sprint D2.8.16 - reframed from a mock BUY/SELL/WAIT signal generator
// (confidence %, entry/stopLoss/takeProfit) into a real market regime
// overview. This platform has a permanent, repeatedly-documented principle
// against ever generating a trade signal, a target price, or a win-rate
// claim (see types/intelligence-decision-context.ts,
// types/verified-answer-response.ts) - a live "BUY EURUSD, 82% confidence"
// feature served to paying customers would be automated trading-signal
// generation, not decision intelligence. This page instead shows the SAME
// real regime/decision-state/Intelligence Score/evidence data the
// Workspace Research panel already shows for one symbol, batched across a
// fixed set of core instruments via GET /api/private/intelligence/overview
// (ResearchSnapshotService, unmodified - no second engine).
// Sprint UI-02.7 - cross-dashboard consistency: self min-h-screen/max-w-6xl
// wrapper removed (AppShell already provides it). Same overview fetch,
// same loading/error/ready states.
import { useCallback, useEffect, useState } from "react";
import Skeleton from "@/components/ui/Skeleton";
import ErrorState from "@/components/ui/ErrorState";
import Button from "@/components/ui/Button";
import Disclaimer from "@/components/ui/Disclaimer";
import PageHeader from "@/components/ui/PageHeader";
import RegimeOverviewCard from "@/components/signals/RegimeOverviewCard";
import Card from "@/components/ui/Card";
import { profileForMiSymbol } from "@/services/macro/macro-alignment";
import type { MacroOverviewItem } from "@/services/macro/macro-overview";
import type { MarketRegimeOverviewItem } from "@/types/market-regime-overview";

type LoadState = "loading" | "ready" | "error";

export default function SignalsPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [items, setItems] = useState<MarketRegimeOverviewItem[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  // Macro Alignment loads on its own: a slow quote feed must never delay or break the regime cards.
  // undefined = still loading; null = unavailable.
  const [macro, setMacro] = useState<MacroOverviewItem[] | null | undefined>(undefined);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    fetch("/api/private/intelligence/overview", { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j?.status === "ok" && Array.isArray(j.data?.items)) {
          setItems(j.data.items as MarketRegimeOverviewItem[]);
          setState("ready");
        } else {
          setState("error");
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState("error");
      });
    return () => {
      controller.abort();
    };
  }, [reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    setMacro(undefined);
    fetch("/api/private/macro-alignment/overview?set=signals", { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => setMacro(j?.status === "ok" && Array.isArray(j.data?.items) ? (j.data.items as MacroOverviewItem[]) : null))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setMacro(null);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const macroFor = (symbol: string): MacroOverviewItem | null | undefined => {
    if (macro === undefined) return undefined;
    const profile = profileForMiSymbol(symbol);
    if (!profile || !macro) return null;
    return macro.find((m) => m.asset === profile.id) ?? null;
  };

  return (
    <div>
      <PageHeader
        eyebrow="AI Signals"
        title="Market regime, at a glance"
        description="Real market regime, macro alignment and data quality for the core markets - never a BUY/SELL call, never a trade recommendation."
      />

      <Card padding="sm" className="mb-6 space-y-1 text-xs text-text-2">
        <p className="font-semibold text-text">How to read each card</p>
        <p>
          <span className="text-text">Regime</span> - what the market is doing now (trending, ranging, breakout...) and how sure the rule set is.{" "}
          <span className="text-text">Macro alignment</span> - how many macro drivers (dollar, yields, stocks, volatility, the asset&apos;s own move) point the same way; a rule-based
          agreement, not a forecast.
        </p>
        <p>
          <span className="text-text">Data quality</span> - how complete the data behind the reading is. It is close to the same for every market with full data, so it does not rank
          markets. <span className="text-text">Risk</span> - the worst of eight risk categories; the card names what drives it.
        </p>
      </Card>

      {state === "loading" && (
        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-live="polite">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </section>
      )}

      {state === "error" && (
        <ErrorState
          title="Could not load market overview"
          description="Check an individual symbol from the Market Intelligence page, or try again."
          action={
            <Button onClick={retry} variant="secondary" size="sm">
              Try again
            </Button>
          }
        />
      )}

      {state === "ready" && (
        <>
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <RegimeOverviewCard key={item.symbol} item={item} macro={macroFor(item.symbol)} />
            ))}
          </section>
          <Disclaimer />
        </>
      )}
    </div>
  );
}
