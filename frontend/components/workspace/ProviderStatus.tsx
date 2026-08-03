"use client";

// components/workspace/ProviderStatus.tsx
// Sprint D2.3 (Phase 2) - Addition 3. Institutional transparency: shows which
// market-data provider is primary and whether a fallback is ready, from the
// read-only /api/private/market-data/status endpoint. Never shows keys. Fails
// quietly to an "unknown" state rather than breaking the workspace chrome.
import { useEffect, useState } from "react";

interface StatusData {
  primary: string | null;
  fallback: string | null;
  fallbackReady: boolean;
}

const LABELS: Record<string, string> = {
  "twelve-data": "TwelveData",
  "alpha-vantage": "AlphaVantage",
  "market-data": "Market Data",
};
const label = (name: string | null) => (name ? (LABELS[name] ?? name) : "Unknown");

export default function ProviderStatus() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/private/market-data/status")
      .then((r) => r.json())
      .then((j) => {
        if (active && j?.status === "ok" && j.data) setStatus(j.data as StatusData);
        else if (active) setFailed(true);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  const online = !!status?.primary && !failed;
  return (
    <div className="inline-flex items-center gap-2 rounded-control border border-border bg-ink-2 px-3 py-1.5 text-xs">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${online ? "bg-signal-up" : "bg-text-3"}`} />
      <span className="font-medium text-text">{online ? label(status!.primary) : "Market data"}</span>
      {online && status!.fallbackReady && <span className="text-text-3">· fallback ready</span>}
      {failed && <span className="text-text-3">· status unavailable</span>}
    </div>
  );
}
