"use client";

// components/workspace/MarketRibbon.tsx
// Sprint D2.3 (Phase 4) - the persistent Market Ribbon, powered by the D2.2
// MarketDataService (NOT TradingView). Shows the enabled markets with live
// price + session change from the batch snapshots endpoint, and marks
// not-yet-served markets (NIFTY / BANKNIFTY) as "pending" rather than showing
// a fabricated price. Clicking a live cell makes it the workspace's active
// symbol (drives every panel). Polls every 60s; the service cache absorbs the
// load. Horizontally scrollable so it never breaks the layout on small screens.
import { useEffect, useState } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import Skeleton from "@/components/ui/Skeleton";
import { formatPrice, formatPercent } from "@/lib/financial-format";
import { FIN_PRIMARY, FIN_SECONDARY, financialDirectionClass, directionFromChange } from "@/components/ui/financial-typography";

interface RibbonItem {
  symbol: string;
  label: string;
  live: boolean;
}

// Requested set (Phase 4). Crypto is served as USD (the platform's Twelve Data
// mapping), shown here with the familiar pairing.
//
// Production Smoke (Beta) - NIFTY50/BANKNIFTY removed from this ribbon
// only: the Angel One provider is currently failing to serve them in
// production (both showed "unavailable" live), which is honest but noisy
// clutter on the one row every dashboard page shows. Display-only change -
// market-registry.ts still lists both enabled: true (chat resolution via
// AI Assistant is unaffected) and instrument-catalog.ts's provider
// mappings are untouched, so this is trivially reversible once Angel One
// connectivity is fixed. Owner decided against touching the ~12 validator
// scripts that treat both as required test instruments - that's a
// separate, larger scoped change, not a display fix.
const ITEMS: RibbonItem[] = [
  { symbol: "EURUSD", label: "EUR/USD", live: true },
  { symbol: "GBPUSD", label: "GBP/USD", live: true },
  { symbol: "USDJPY", label: "USD/JPY", live: true },
  { symbol: "XAUUSD", label: "Gold", live: true },
  { symbol: "XAGUSD", label: "Silver", live: true },
  { symbol: "BTCUSD", label: "BTC/USD", live: true },
  { symbol: "ETHUSD", label: "ETH/USD", live: true },
];

interface Snap {
  symbol: string;
  ok: boolean;
  price?: number;
  changePercent?: number;
}

// Gentle poll: the batch route's shared cache (see
// services/market-data/shared-instance.ts) absorbs repeat polls, so this
// mostly hits cache and stays within the provider's free-tier per-minute
// budget.
const POLL_MS = 90_000;

export default function MarketRibbon() {
  const { symbol: active, setSymbol } = useWorkspace();
  const [data, setData] = useState<Record<string, Snap>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const liveSymbols = ITEMS.filter((i) => i.live).map((i) => i.symbol);
    let controller = new AbortController();
    const load = async () => {
      controller = new AbortController();
      try {
        const res = await fetch(`/api/private/market-data/snapshots?symbols=${liveSymbols.join(",")}`, {
          signal: controller.signal,
        });
        const json = await res.json();
        if (json?.status === "ok" && Array.isArray(json.data?.snapshots)) {
          const map: Record<string, Snap> = {};
          for (const s of json.data.snapshots) map[s.symbol] = s;
          setData(map);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        /* keep last-known values on a transient failure */
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, []);

  return (
    <div className="overflow-x-auto rounded-panel border border-border bg-ink-2">
      <div className="flex min-w-max divide-x divide-border">
        {ITEMS.map((item) => {
          const snap = data[item.symbol];
          const isActive = item.symbol === active;
          const direction = directionFromChange(snap?.changePercent);
          return (
            <button
              key={item.symbol}
              type="button"
              disabled={!item.live}
              onClick={() => item.live && setSymbol(item.symbol)}
              aria-pressed={isActive}
              className={`flex min-w-[132px] flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors ${
                item.live ? "hover:bg-ink-3" : "cursor-default opacity-50"
              } ${isActive ? "bg-ink-3" : ""}`}
            >
              <span className={`text-xs font-semibold ${isActive ? "text-gold" : "text-text"}`}>{item.label}</span>
              {!item.live ? (
                <span className="text-xs text-text-3">pending</span>
              ) : loading && !snap ? (
                <Skeleton className="h-3.5 w-14" />
              ) : snap?.ok && snap.price !== undefined ? (
                <span className="flex items-baseline gap-1.5">
                  <span className={`${FIN_PRIMARY} text-sm`}>{formatPrice(snap.price, { maxDecimals: 5 })}</span>
                  {snap.changePercent !== undefined && (
                    <span className={`${FIN_SECONDARY} text-xs ${financialDirectionClass(direction)}`}>{formatPercent(snap.changePercent)}</span>
                  )}
                </span>
              ) : (
                <span className="text-xs text-text-3">unavailable</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
