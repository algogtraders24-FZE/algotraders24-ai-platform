"use client";

// components/workspace/WorkspaceResearch.tsx
// Sprint D2.6.11 - Universal Instrument Workspace, Dynamic Chart Resolution
// & Live Workspace Integration. Replaces the stale "Research workspace
// arrives in D2.4." placeholder with a real research view of the active
// instrument's current deterministic intelligence: market state, regime,
// hypotheses, supporting/opposing evidence, invalidation conditions,
// Intelligence Score, historical validation, risk, and provenance - all
// via the SAME VerifiedAnswerResponse contract and VerifiedAIAnswerCard UI
// D2.6.10 already built (no second research engine, no duplicated
// Intelligence Score, no new formula). Data comes from
// GET /api/private/intelligence/research?symbol=X (ResearchSnapshotService
// - a thin composition over the existing D2.6.1/D2.6.5/D2.6.10 chat-facing
// layer, no direct D2.5/D2.6 internal-engine import from this component).
//
// Re-fetches on every symbol change and resets to "loading" immediately
// (never leaves the previous symbol's panels visible while the new
// symbol's data is in flight) - the same AbortController-guarded pattern
// IntelligencePanel.tsx already established.
import { useEffect, useState } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import VerifiedAIAnswerCard from "@/components/intelligence-workspace/VerifiedAIAnswerCard";
import type { VerifiedAnswerResponse } from "@/types/verified-answer-response";

type LoadState = "loading" | "resolved" | "insufficient-data" | "clarification-required" | "unresolved" | "error";

interface ResearchApiData {
  status: LoadState;
  verifiedAnswer?: VerifiedAnswerResponse;
  message?: string;
}

export default function WorkspaceResearch() {
  const { symbol } = useWorkspace();
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<ResearchApiData | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setData(null);
    fetch(`/api/private/intelligence/research?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j?.status === "ok" && j.data?.status) {
          setData(j.data as ResearchApiData);
          setState(j.data.status as LoadState);
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
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (state === "resolved" && data?.verifiedAnswer) {
    return <VerifiedAIAnswerCard result={data.verifiedAnswer} />;
  }

  if (state === "insufficient-data") {
    return (
      <EmptyState
        title="Research unavailable"
        description={`No provider could confirm live market data for ${symbol} right now. Shown honestly rather than with a fabricated result.`}
      />
    );
  }

  if (state === "clarification-required") {
    return <EmptyState title="Could not resolve this instrument" description={data?.message ?? `${symbol} could not be identified.`} />;
  }

  return (
    <EmptyState
      title="Research unavailable"
      description="Could not build a research snapshot right now. Try again, or switch symbols from the Global Symbol Selector."
    />
  );
}
