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
import { useEffect, useState } from "react";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Disclaimer from "@/components/ui/Disclaimer";
import RegimeOverviewCard from "@/components/signals/RegimeOverviewCard";
import type { MarketRegimeOverviewItem } from "@/types/market-regime-overview";

type LoadState = "loading" | "ready" | "error";

export default function SignalsPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [items, setItems] = useState<MarketRegimeOverviewItem[]>([]);

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
  }, []);

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">AI Signals</h1>
          <p className="text-sm text-text-3">
            Real market regime, decision state, and Intelligence Score for the core markets - never a BUY/SELL call, never a trade recommendation.
          </p>
        </header>

        {state === "loading" && (
          <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-live="polite">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </section>
        )}

        {state === "error" && (
          <EmptyState title="Could not load market overview" description="Try again, or check an individual symbol from the Market Intelligence page." />
        )}

        {state === "ready" && (
          <>
            <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <RegimeOverviewCard key={item.symbol} item={item} />
              ))}
            </section>
            <Disclaimer />
          </>
        )}
      </div>
    </div>
  );
}
