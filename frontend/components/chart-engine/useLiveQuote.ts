"use client";

// components/chart-engine/useLiveQuote.ts
// Live bid/ask for the Native Chart's own price panel - matching the
// real MT5 terminal's bid/ask lines the user pointed out were missing
// (the chart previously only showed the latest CANDLE close, never the
// actual live tradeable bid/ask). Mirrors useChartCandles.ts's own
// fetch/poll/AbortController pattern exactly - the same
// GET /api/private/market-data/snapshot endpoint every other bid/ask
// display on this platform (WorkspaceHeader, MarketRibbon) already calls,
// never a second/duplicate provider call. A background poll failure
// never disrupts what's already showing - the same "last good data
// keeps showing" discipline useChartCandles established.
import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 15_000;

export interface LiveQuote {
  bid: number;
  ask: number;
}

/** Undefined until a real quote has loaded; stays undefined forever for an instrument/provider combination that genuinely has no bid/ask (e.g. a spot-only feed) - never a fabricated pair. */
export function useLiveQuote(symbol: string): LiveQuote | undefined {
  const [quote, setQuote] = useState<LiveQuote | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setQuote(undefined);

    async function fetchOnce() {
      try {
        const params = new URLSearchParams({ symbol });
        const res = await fetch(`/api/private/market-data/snapshot?${params.toString()}`, { signal: controller.signal });
        const json = await res.json();
        if (cancelled || !res.ok || json?.status !== "ok") return;
        const snapshot = json.data?.snapshot;
        const bid = typeof snapshot?.bid === "number" && Number.isFinite(snapshot.bid) ? snapshot.bid : undefined;
        const ask = typeof snapshot?.ask === "number" && Number.isFinite(snapshot.ask) ? snapshot.ask : undefined;
        if (bid !== undefined && ask !== undefined && ask >= bid) setQuote({ bid, ask });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        // A transient fetch failure never clears an already-showing quote -
        // the last good bid/ask keeps displaying, same as a candle poll miss.
      }
    }

    fetchOnce();
    const intervalId = setInterval(fetchOnce, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(intervalId);
    };
  }, [symbol]);

  return quote;
}
