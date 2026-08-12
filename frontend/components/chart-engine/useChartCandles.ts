"use client";

// components/chart-engine/useChartCandles.ts
// Sprint D2.7.2 - the native chart's ONE data-fetching hook. Calls the new
// GET /api/private/market-data/candles route (Phase 2) - never a provider
// API directly, never a second client-side symbol/timeframe registry.
// Mirrors the existing Workspace fetch-effect pattern (WorkspaceHeader/
// MarketRibbon: AbortController per effect run, cleanup on symbol change)
// rather than inventing a new one.
//
// Sprint D2.7.3, Phase 5 - real streaming infrastructure does not exist
// anywhere in this platform's provider architecture (Twelve Data/Alpha
// Vantage/Binance/Angel One are all request/response REST APIs - no
// WebSocket feed is configured or in scope, per the sprint's own explicit
// non-goal). The honest fetch-based analog is periodic polling: a
// background refetch every POLL_INTERVAL_MS, which the candles route's own
// short-lived TtlCache (15s) already absorbs without extra provider load.
// A background poll NEVER flashes "loading" or an error over data that's
// already showing - only the initial fetch and a symbol/timeframe change
// show the loading state; a failed background poll is silently skipped
// (the last good data keeps showing) so a transient hiccup never disrupts
// an otherwise-working chart.
import { useEffect, useState } from "react";
import type { ChartDataResult, ChartDataStatus, ChartSeries } from "@/types/chart-data";
import type { SignalTimeframe } from "@/types/signal";

const DEFAULT_OUTPUT_SIZE = 300;
const POLL_INTERVAL_MS = 20_000;

// Sprint D2.7.3 (Phase 14) - the one place a fetched ChartSeries becomes a
// top-level, user-facing ChartDataStatus. Precedence (most to least
// important to surface): empty (nothing usable at all) > stale (the whole
// payload may be old - D2.6.4's freshness policy said so) > partial (some
// candles were rejected, but the rest are usable) > ready. `series.
// freshness` and `series.rejectedCount` remain available on the result for
// a caller that wants the finer-grained detail regardless of which single
// status wins here.
function deriveStatus(series: ChartSeries): ChartDataStatus {
  if (series.candles.length === 0) return "empty";
  if (series.freshness === "stale") return "stale";
  if (series.rejectedCount > 0) return "partial";
  return "ready";
}

export function useChartCandles(symbol: string, timeframe: SignalTimeframe, outputSize = DEFAULT_OUTPUT_SIZE): ChartDataResult {
  const [result, setResult] = useState<ChartDataResult>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setResult({ status: "loading" });

    async function fetchOnce(isBackgroundPoll: boolean) {
      try {
        const params = new URLSearchParams({ symbol, timeframe, outputSize: String(outputSize) });
        const res = await fetch(`/api/private/market-data/candles?${params.toString()}`, { signal: controller.signal });
        const json = await res.json();
        if (cancelled) return;

        if (!res.ok || json?.status !== "ok") {
          if (isBackgroundPoll) return; // keep showing the last good data - never disrupt a working chart over a transient poll failure
          const reason = json?.error?.details?.reason as string | undefined;
          if (reason === "unsupported_symbol" || json?.error?.code === "VALIDATION") {
            setResult({ status: "unsupported", message: json?.error?.message ?? "This instrument has no chartable data yet." });
          } else {
            setResult({ status: "error", message: json?.error?.message ?? "Chart data is temporarily unavailable." });
          }
          return;
        }
        const series = json.data.series as ChartSeries;
        setResult({ status: deriveStatus(series), series });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        if (!isBackgroundPoll) setResult({ status: "error", message: "Chart data is temporarily unavailable." });
      }
    }

    fetchOnce(false);
    const intervalId = setInterval(() => fetchOnce(true), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(intervalId);
    };
  }, [symbol, timeframe, outputSize]);

  return result;
}
