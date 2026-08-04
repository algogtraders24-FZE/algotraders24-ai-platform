"use client";

// components/workspace/ProviderStatus.tsx
// Sprint D2.3 (Phase 2) - Addition 3. Institutional transparency: shows which
// market-data provider is primary and whether a fallback is ready, from the
// read-only /api/private/market-data/status endpoint. Never shows keys. Fails
// quietly to an "unknown" state rather than breaking the workspace chrome.
//
// Sprint D2.3.S3 - the dot now reflects the Provider Health Monitor's real
// state (healthy/degraded/rate_limited/offline) instead of a binary online/
// offline guess, so a rate-limited-but-not-fully-down provider reads as
// amber, not green. Purely additive to this existing component - no layout
// change, same "fail quietly" behavior when status is unreachable.
import { useEffect, useState } from "react";

type ProviderHealthState = "healthy" | "degraded" | "rate_limited" | "offline";

interface StatusData {
  primary: string | null;
  fallback: string | null;
  fallbackReady: boolean;
  primaryState: ProviderHealthState | null;
}

const LABELS: Record<string, string> = {
  "twelve-data": "TwelveData",
  "alpha-vantage": "AlphaVantage",
  "market-data": "Market Data",
};
const label = (name: string | null) => (name ? (LABELS[name] ?? name) : "Unknown");

const DOT_COLOR: Record<ProviderHealthState, string> = {
  healthy: "bg-signal-up",
  degraded: "bg-warn",
  rate_limited: "bg-warn",
  offline: "bg-text-3",
};
const STATE_LABEL: Record<ProviderHealthState, string> = {
  healthy: "",
  degraded: "· degraded",
  rate_limited: "· rate limited",
  offline: "· offline",
};

export default function ProviderStatus() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/private/market-data/status", { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j?.status === "ok" && j.data) setStatus(j.data as StatusData);
        else setFailed(true);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, []);

  const online = !!status?.primary && !failed;
  const state: ProviderHealthState = status?.primaryState ?? "healthy";
  return (
    <div className="inline-flex items-center gap-2 rounded-control border border-border bg-ink-2 px-3 py-1.5 text-xs">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${online ? DOT_COLOR[state] : "bg-text-3"}`} />
      <span className="font-medium text-text">{online ? label(status!.primary) : "Market data"}</span>
      {online && state !== "healthy" && <span className="text-text-3">{STATE_LABEL[state]}</span>}
      {online && state === "healthy" && status!.fallbackReady && <span className="text-text-3">· fallback ready</span>}
      {failed && <span className="text-text-3">· status unavailable</span>}
    </div>
  );
}
