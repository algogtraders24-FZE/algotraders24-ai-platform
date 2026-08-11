// components/intelligence-workspace/format.ts
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. Shared, presentation-only label/tone helpers for every
// component in this directory - no computation, only formatting of
// already-real, already-verified values. Same GOOD/MID/BAD tone
// convention components/market-intelligence/AnalysisResult.tsx already
// established (Sprint L2.1), reused here rather than inventing a second
// color system.
import type { DecisionState } from "@/types/intelligence-decision-context";
import type { DataQualityState } from "@/types/real-time-intelligence";
import type { RiskLevel } from "@/types/risk";
import type { BadgeTone } from "@/components/ui/Badge";

export function formatLabel(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const DECISION_STATE_TONE: Record<DecisionState, BadgeTone> = {
  "well-supported": "success",
  "partially-supported": "warning",
  conflicted: "danger",
  "insufficient-intelligence": "neutral",
};

export const DATA_STATUS_TONE: Record<DataQualityState, BadgeTone> = {
  fresh: "success",
  cached: "info",
  stale: "warning",
  unknown: "neutral",
  unavailable: "danger",
};

export const RISK_LEVEL_TONE: Record<RiskLevel, BadgeTone> = {
  low: "success",
  medium: "warning",
  high: "danger",
};

/** "Trending Bullish" gets an up-tone, "Trending Bearish"/"Breakdown" a down-tone - every other regime is deliberately neutral (never implying a direction the regime itself doesn't state). */
export function regimeTone(regimeType: string): BadgeTone {
  if (regimeType === "trending-bullish" || regimeType === "breakout") return "success";
  if (regimeType === "trending-bearish" || regimeType === "breakdown") return "danger";
  if (regimeType === "insufficient-data") return "neutral";
  return "warning";
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
