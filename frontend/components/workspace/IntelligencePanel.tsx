"use client";

// components/workspace/IntelligencePanel.tsx
// Sprint D2.3 (Phase 6) - the AI Intelligence Panel: the workspace's primary,
// visually-dominant decision surface (rendered inside the `emphasis`
// WorkspaceSection in app/dashboard/workspace/page.tsx). Presentation layer
// ONLY - every value here comes from IntelligencePanelData, itself a
// same-request projection of the existing CopilotAnalysis (D2.2's real
// snapshot + indicator + risk + confidence pipeline, unmodified). No indicator
// math, no trend/bias classification, and no synthetic price levels happen in
// this file - that logic lives once in services/ai/intelligence-panel.service.ts.
// A field the engine did not produce renders "Not available" / "Insufficient
// data", never a guess (Key Levels is always empty today - see
// types/intelligence-panel.ts for why).
import { useEffect, useState } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import InfoTooltip from "@/components/ui/InfoTooltip";
import Disclaimer from "@/components/ui/Disclaimer";
import StatField from "@/components/workspace/StatField";
import type { IntelligencePanelData, MarketStatusLabel, RiskBand } from "@/types/intelligence-panel";
import type { ConfidenceBand } from "@/types/technical-context";
import { LIQUIDITY_DEFINITION } from "@/data/educational-terms";

type LoadState = "loading" | "ready" | "unavailable" | "error";

const STATUS_LABEL: Record<MarketStatusLabel, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
  transition: "Transition",
  high_volatility: "High Volatility",
  insufficient: "Insufficient Data",
};
const STATUS_TONE: Record<MarketStatusLabel, BadgeTone> = {
  bullish: "success",
  bearish: "danger",
  neutral: "neutral",
  transition: "info",
  high_volatility: "warning",
  insufficient: "neutral",
};

const CONFIDENCE_LABEL: Record<ConfidenceBand, string> = {
  insufficient: "Insufficient",
  low: "Low",
  medium: "Medium",
  high: "High",
};
const CONFIDENCE_TONE: Record<ConfidenceBand, BadgeTone> = {
  insufficient: "neutral",
  low: "warning",
  medium: "info",
  high: "success",
};

const RISK_LABEL: Record<RiskBand, string> = {
  insufficient: "Insufficient data",
  low: "Low",
  medium: "Moderate",
  high: "High",
};
const RISK_TONE: Record<RiskBand, BadgeTone> = {
  insufficient: "neutral",
  low: "success",
  medium: "warning",
  high: "danger",
};

const DIRECTION_LABEL: Record<string, string> = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral" };
const MOMENTUM_LABEL: Record<string, string> = { strengthening: "Strengthening", weakening: "Weakening", neutral: "Neutral" };
const BAND_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
const SESSION_LABEL: Record<string, string> = { open: "Open", closed: "Closed", unknown: "Unknown" };

const KEY_LEVEL_FIELDS: Array<{ key: keyof IntelligencePanelData["keyLevels"]; label: string }> = [
  { key: "resistance", label: "Resistance" },
  { key: "support", label: "Support" },
  { key: "invalidation", label: "Invalidation" },
  { key: "breakout", label: "Breakout Level" },
  { key: "pullback", label: "Pullback Zone" },
];

function freshness(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function utcTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.toISOString().slice(11, 16)} UTC`;
}

export default function IntelligencePanel() {
  const { symbol } = useWorkspace();
  const [data, setData] = useState<IntelligencePanelData | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    fetch("/api/private/trading-copilot/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.status === "ok" && j.data?.panel) {
          setData(j.data.panel as IntelligencePanelData);
          setState("ready");
        } else if (j?.error?.code === "PROVIDER_UNAVAILABLE") {
          setState("unavailable");
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

  if (state === "loading") {
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <EmptyState
        title="Analysis unavailable"
        description={`No provider could serve ${symbol} right now. This is shown honestly rather than with a fabricated result.`}
      />
    );
  }

  if (state === "error" || !data) {
    return <EmptyState title="Could not load AI Intelligence" description="Try again, or switch symbols from the Global Symbol Selector." />;
  }

  const structuredEntries: Array<{ label: string; value: string }> = [
    { label: "Trend", value: data.structure.trend ? DIRECTION_LABEL[data.structure.trend] : "Insufficient data" },
    { label: "Momentum", value: data.structure.momentum ? MOMENTUM_LABEL[data.structure.momentum] : "Insufficient data" },
    { label: "Volatility", value: data.structure.volatility ? BAND_LABEL[data.structure.volatility] : "Insufficient data" },
    { label: "Liquidity", value: data.structure.liquidity ? BAND_LABEL[data.structure.liquidity] : "Not available" },
    { label: "Session", value: SESSION_LABEL[data.structure.session] },
    { label: "Bias", value: data.structure.bias ? DIRECTION_LABEL[data.structure.bias] : "Insufficient data" },
  ];

  // Sprint D2.3.S4 - "Based on: ..." is derived only from factors genuinely
  // present on this response (never a fixed, possibly-fabricated list) -
  // describes what the analysis actually considered, not a trade-success
  // probability.
  const confidenceBasis = [
    data.structure.trend && "Trend",
    data.structure.momentum && "Momentum",
    data.structure.volatility && "Volatility",
    (data.structure.trend || data.structure.momentum || data.structure.bias) && "Market Structure",
    data.evidence.length > 0 && "Evidence",
  ].filter((v): v is string => Boolean(v));

  return (
    <div className="space-y-5">
      {/* 1-3: Market Status / AI Confidence / Risk Level */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatField label="Market Status">
          <Badge tone={STATUS_TONE[data.marketStatus]} className="text-sm">
            {STATUS_LABEL[data.marketStatus]}
          </Badge>
        </StatField>
        <StatField label="AI Confidence">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg text-text">{data.confidence.percent}%</span>
            <Badge tone={CONFIDENCE_TONE[data.confidence.band]}>{CONFIDENCE_LABEL[data.confidence.band]}</Badge>
          </div>
          {/* Sprint D2.3.S4 - describes what the analysis considered (analysis certainty), never a probability the trade will succeed. */}
          {confidenceBasis.length > 0 && (
            <p className="mt-1.5 text-xs text-text-3">Based on: {confidenceBasis.join(", ")}</p>
          )}
        </StatField>
        <StatField label="Risk Level">
          <Badge tone={RISK_TONE[data.risk.band]} className="text-sm">
            {RISK_LABEL[data.risk.band]}
          </Badge>
          {/* Sprint D2.3.S4 - risk context is never silently omitted, even when the engine produced no specific notes. */}
          <p className="mt-1.5 text-xs text-text-3">
            {data.risk.explanation || "No specific risk factors were flagged for this analysis."}
          </p>
        </StatField>
      </div>

      {/* 4: Market Structure */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-3">Market Structure</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {structuredEntries.map((f) => (
            <StatField
              key={f.label}
              label={
                f.label === "Liquidity" ? (
                  <span className="inline-flex items-center">
                    {f.label}
                    <InfoTooltip label={f.label} text={LIQUIDITY_DEFINITION.definition} />
                  </span>
                ) : (
                  f.label
                )
              }
            >
              {f.value}
            </StatField>
          ))}
        </div>
      </div>

      {/* 5: Key Levels */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-3">Key Levels</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {KEY_LEVEL_FIELDS.map((f) => {
            const value = data.keyLevels[f.key];
            return (
              <StatField key={f.key} label={f.label} dashed>
                <span className="font-mono text-text-3">{value !== undefined ? value : "Not available"}</span>
              </StatField>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-text-3">
          Not computed by the current engine — shown honestly rather than fabricated.
        </p>
      </div>

      {/* 6: Evidence Summary */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-3">Evidence Summary</h3>
        {data.evidence.length > 0 ? (
          <ul className="space-y-1.5">
            {data.evidence.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-2">
                <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold" />
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-text-3">Insufficient data for evidence-backed observations.</p>
        )}
      </div>

      {/* 7: Timestamp */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border pt-3 text-xs text-text-3">
        <span>
          Symbol <span className="font-mono text-text-2">{data.symbol}</span>
        </span>
        <span>
          Timeframe <span className="font-mono text-text-2">{data.timeframe}</span>
        </span>
        <span>
          Analyzed <span className="font-mono text-text-2">{utcTime(data.computedAt)}</span>
        </span>
        <span>
          Freshness <span className="font-mono text-text-2">{freshness(data.dataFreshnessMs)}</span>
        </span>
      </div>

      <Disclaimer className="border-t-0 pt-0" />
    </div>
  );
}
