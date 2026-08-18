"use client";

// components/workspace/WorkspaceHeader.tsx
// Sprint D2.3 (Phase 2) - Addition 1. The professional workspace header:
// active symbol, live/closed status, the market-data provider that served the
// quote, the update time (UTC), and the current workspace (asset class). It
// reads the active symbol from WorkspaceContext and the live values from the
// read-only snapshot endpoint, re-fetching whenever the symbol changes.
import { useEffect, useState } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import Badge from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import StatField from "@/components/workspace/StatField";
import type { MarketSnapshot } from "@/types/market-snapshot";
import { formatPrice } from "@/lib/financial-format";

const PROVIDER_LABELS: Record<string, string> = {
  "twelve-data": "TwelveData",
  "alpha-vantage": "AlphaVantage",
};
const ASSET_LABELS: Record<string, string> = {
  forex: "Forex",
  commodities: "Commodities",
  crypto: "Crypto",
  indices: "Indices",
  stocks: "Stocks",
};

function utcTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : `${d.toISOString().slice(11, 16)} UTC`;
}

export default function WorkspaceHeader() {
  const { symbol, name, assetClass } = useWorkspace();
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    // Sprint D2.8.16 - a real, live-reproduced bug: switching symbols (e.g.
    // EURUSD -> BTCUSD) reset `state` to "loading" but never cleared
    // `snapshot`, so the PREVIOUS symbol's price/provider/timestamp kept
    // rendering under the NEW symbol's title until (if ever) the new fetch
    // resolved - "BTCUSD" shown with EURUSD's stale $1.15744 "price".
    setSnapshot(null);
    fetch(`/api/private/market-data/snapshot?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j?.status === "ok" && j.data?.snapshot) {
          setSnapshot(j.data.snapshot as MarketSnapshot);
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
  }, [symbol]);

  const live = snapshot?.marketStatus === "open";
  // Sprint D2.3 Final Audit - snapshot.cached is true for BOTH a routine
  // fresh cache hit (served within the service's normal TTL, the healthy
  // fast path - services/market-data/market-data.service.ts) and a genuine
  // S3 resilience stale-fallback (served only after every provider failed).
  // Badging every cache hit "Stale" was misleading: a closed-market symbol
  // viewed twice within the same TTL window would flip from "Closed" to a
  // false "Stale" with nothing having actually failed. STALE_THRESHOLD_MS is
  // comfortably above the service's default 60s TTL (with margin for timing
  // jitter) and well under the 5-minute stale-fallback grace window, so it
  // reliably separates the two cases without the client needing to know the
  // server's exact configured TTL.
  const STALE_THRESHOLD_MS = 90_000;
  const isStale = snapshot?.cached === true && (snapshot.cacheAgeMs ?? 0) > STALE_THRESHOLD_MS;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-panel border border-border bg-ink-2 px-5 py-4">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-2xl font-semibold">{symbol}</span>
        <span className="text-sm text-text-3">{name}</span>
      </div>

      {state === "loading" ? (
        <Skeleton className="h-5 w-16" />
      ) : (
        <Badge tone={live ? "success" : isStale ? "warning" : "neutral"} className="gap-1.5">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${live ? "bg-signal-up" : isStale ? "bg-warn" : "bg-text-3"}`}
          />
          {/* Sprint D2.3.S3/Final Audit - "Stale" only for a genuine resilience fallback (isStale, above), never for an ordinary fresh cache hit on a closed market. */}
          {live ? "Live" : isStale ? "Stale" : snapshot ? "Closed" : "Unavailable"}
        </Badge>
      )}

      <StatField bare label="Price">
        {snapshot ? (
          <span className="fin-num">
            {formatPrice(snapshot.price, { maxDecimals: 5 })} {snapshot.quoteCurrency}
          </span>
        ) : (
          "—"
        )}
      </StatField>
      <StatField bare label="Provider">{snapshot ? (PROVIDER_LABELS[snapshot.provider] ?? snapshot.provider) : "—"}</StatField>
      <StatField bare label="Updated">{snapshot ? utcTime(snapshot.timestamp) : "—"}</StatField>
      <StatField bare label="Workspace">{assetClass ? (ASSET_LABELS[assetClass] ?? assetClass) : "—"}</StatField>
    </div>
  );
}
