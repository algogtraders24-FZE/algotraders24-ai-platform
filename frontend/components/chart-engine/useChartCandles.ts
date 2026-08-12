"use client";

// components/chart-engine/useChartCandles.ts
// Sprint D2.7.2 - the native chart's ONE data-fetching hook. Calls the new
// GET /api/private/market-data/candles route (Phase 2) - never a provider
// API directly, never a second client-side symbol/timeframe registry.
// Mirrors the existing Workspace fetch-effect pattern (WorkspaceHeader/
// MarketRibbon: AbortController per effect run, cleanup on symbol change)
// rather than inventing a new one.
import { useEffect, useState } from "react";
import type { ChartDataResult } from "@/types/chart-data";
import type { SignalTimeframe } from "@/types/signal";

const DEFAULT_OUTPUT_SIZE = 300;

export function useChartCandles(symbol: string, timeframe: SignalTimeframe, outputSize = DEFAULT_OUTPUT_SIZE): ChartDataResult {
  const [result, setResult] = useState<ChartDataResult>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setResult({ status: "loading" });

    const params = new URLSearchParams({ symbol, timeframe, outputSize: String(outputSize) });
    fetch(`/api/private/market-data/candles?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || json?.status !== "ok") {
          const reason = json?.error?.details?.reason as string | undefined;
          if (reason === "unsupported_symbol" || json?.error?.code === "VALIDATION") {
            setResult({ status: "unsupported", message: json?.error?.message ?? "This instrument has no chartable data yet." });
          } else {
            setResult({ status: "error", message: json?.error?.message ?? "Chart data is temporarily unavailable." });
          }
          return;
        }
        const series = json.data.series;
        setResult({ status: series.candles.length === 0 ? "empty" : "ready", series });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResult({ status: "error", message: "Chart data is temporarily unavailable." });
      });

    return () => controller.abort();
  }, [symbol, timeframe, outputSize]);

  return result;
}
