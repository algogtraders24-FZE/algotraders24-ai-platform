"use client";

// components/chart-engine/useMicrostructureSnapshot.ts
// Sprint D2.8.10 - Microstructure Visualization & Intelligence Evidence
// Layer. Mirrors useChartCandles.ts's own established fetch-effect pattern
// (AbortController per effect run, cleanup on symbol change) rather than
// inventing a new one - the ONE difference is deliberate: NO background
// polling. Microstructure is not cached server-side (D2.8.5's own design -
// "meant to be read close to real-time"), so a poll interval here would
// directly multiply real Binance calls with nothing absorbing them, unlike
// candles' own TtlCache-backed polling. One real fetch per symbol change is
// the honest, non-abusive default (D2.8.10 Phase 8's own "no uncontrolled
// polling, no duplicate provider requests" rule).
import { useEffect, useState } from "react";
import type { MicrostructureSnapshot } from "@/types/microstructure";

export type MicrostructureFetchStatus = "loading" | "supported" | "unsupported" | "error";

export interface MicrostructureFetchResult {
  status: MicrostructureFetchStatus;
  snapshot?: MicrostructureSnapshot;
  message?: string;
}

export function useMicrostructureSnapshot(symbol: string | undefined): MicrostructureFetchResult {
  const [result, setResult] = useState<MicrostructureFetchResult>({ status: "loading" });

  useEffect(() => {
    if (!symbol) {
      setResult({ status: "unsupported" });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setResult({ status: "loading" });

    async function fetchOnce() {
      try {
        const params = new URLSearchParams({ symbol: symbol as string });
        const res = await fetch(`/api/private/market-data/microstructure?${params.toString()}`, { signal: controller.signal });
        const json = await res.json();
        if (cancelled) return;

        if (!res.ok || json?.status !== "ok") {
          setResult({ status: "error", message: json?.error?.message ?? "Microstructure evidence is temporarily unavailable." });
          return;
        }
        if (json.data.supported === false) {
          setResult({ status: "unsupported" });
          return;
        }
        setResult({ status: "supported", snapshot: json.data.snapshot as MicrostructureSnapshot });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setResult({ status: "error", message: "Microstructure evidence is temporarily unavailable." });
      }
    }

    fetchOnce();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol]);

  return result;
}
