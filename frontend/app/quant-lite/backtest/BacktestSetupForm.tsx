"use client";
// app/quant-lite/backtest/BacktestSetupForm.tsx
// Q0.9 Part 23, Q1.1 Part 7 - Backtest Setup creates a REAL job and
// navigates to /quant-lite/results/[jobId] immediately. As of Q1.1, the
// data-coverage feedback shown here comes from a live call to the real
// server-authoritative coverage API (GET /api/quant-lite/coverage) -
// debounced as the user edits dates - rather than a client-side
// approximation, so this screen can never show a different number than
// what the job itself will be judged against.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import ExecutionAssumptionsPanel from "@/components/quant-lite/ExecutionAssumptionsPanel";
import CoverageAssessmentPanel from "@/components/quant-lite/CoverageAssessmentPanel";
import { QUANT_LITE_CAPABILITY } from "@/data/quant-lite-capability";
import { createBacktestJob, getCoverageAssessment, loadDraftSpec, QuantLiteApiError } from "@/services/quant-lite/QuantLiteBacktestService";
import { recordRecentRun } from "@/services/quant-lite/recentRuns";
import { validateInitialCapital, validateRiskPct } from "@/services/quant-lite/validateStrategySpec";
import type { StrategySpec } from "@/types/quant-lite";
import type { CoverageAssessment } from "@/types/quant-lite-coverage";

const COVERAGE_DEBOUNCE_MS = 500;

export default function BacktestSetupForm() {
  const router = useRouter();
  const [draft, setDraft] = useState<{ spec: StrategySpec; riskPct: number } | null | undefined>(undefined);
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [capital, setCapital] = useState(10000);
  const [riskPct, setRiskPct] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [coverage, setCoverage] = useState<CoverageAssessment | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);

  useEffect(() => {
    const loaded = loadDraftSpec<{ spec: StrategySpec; riskPct: number }>();
    setDraft(loaded);
    if (loaded) setRiskPct(loaded.riskPct);
  }, []);

  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    setCoverageLoading(true);
    const timer = setTimeout(async () => {
      try {
        const assessment = await getCoverageAssessment(draft.spec.symbol, draft.spec.timeframe, startDate, endDate);
        if (!cancelled) setCoverage(assessment);
      } catch {
        if (!cancelled) setCoverage(null);
      } finally {
        if (!cancelled) setCoverageLoading(false);
      }
    }, COVERAGE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.spec.symbol, draft?.spec.timeframe, startDate, endDate]);

  if (draft === undefined) return null;

  if (draft === null) {
    return (
      <EmptyState
        title="No strategy selected"
        description="Build a strategy first, then come back here to run a backtest."
        action={<Button onClick={() => router.push("/quant-lite/builder")}>Go to Strategy Builder</Button>}
      />
    );
  }

  const capabilityEntry = QUANT_LITE_CAPABILITY.find((c) => c.symbol === draft.spec.symbol);
  const supportsRealExecution = Boolean(capabilityEntry && capabilityEntry.timeframes.includes(draft.spec.timeframe));

  async function handleRun() {
    if (!draft) return;

    if (!supportsRealExecution || !capabilityEntry) {
      setError(
        `Real backtests are currently limited to ${QUANT_LITE_CAPABILITY.length} symbols, each with its own verified timeframe list. ` +
          `${draft.spec.symbol} / ${draft.spec.timeframe} is not yet supported - go back to the Builder and choose a supported symbol/timeframe.`,
      );
      return;
    }

    const capitalError = validateInitialCapital(capital);
    const riskError = validateRiskPct(riskPct);
    const firstError = capitalError || riskError;
    if (firstError) {
      setError(firstError);
      return;
    }
    if (coverage?.policy === "DATA_UNAVAILABLE") {
      setError(coverage.message);
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      const job = await createBacktestJob({
        strategy: draft.spec,
        symbol: draft.spec.symbol,
        timeframe: draft.spec.timeframe,
        dateRange: { start: startDate, end: endDate },
        initialCapital: capital,
        riskPct,
      });
      recordRecentRun({
        jobId: job.jobId,
        name: draft.spec.name || "Untitled strategy",
        symbol: draft.spec.symbol,
        timeframe: draft.spec.timeframe,
        submittedAt: new Date().toISOString(),
      });
      router.push(`/quant-lite/results/${job.jobId}`);
    } catch (e) {
      const message = e instanceof QuantLiteApiError ? e.message : "Could not submit the backtest. Please try again.";
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-text">Strategy</h2>
        <p className="text-sm text-text-2">{draft.spec.name || "Untitled strategy"}</p>
        <p className="text-xs text-text-3">
          {draft.spec.symbol} &middot; {draft.spec.timeframe}
        </p>
        {!supportsRealExecution && (
          <p className="mt-2 rounded-control border border-info/30 bg-info/10 p-2 text-xs text-text-2">
            {draft.spec.symbol} / {draft.spec.timeframe} is not a verified real-execution combination. Go back to the Builder to choose a supported symbol/timeframe.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-text">Backtest Parameters</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-text-3">Start date</label>
            <Input type="date" className="mt-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-3">End date</label>
            <Input type="date" className="mt-1" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-3">Initial capital</label>
            <Input type="number" className="mt-1" value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-3">Risk % per trade</label>
            <Input type="number" step="0.1" className="mt-1" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} />
          </div>
        </div>
        {error && <p className="mt-3 rounded-control border border-danger/30 bg-danger/10 p-2 text-sm text-danger">{error}</p>}
      </Card>

      <CoverageAssessmentPanel assessment={coverage} loading={coverageLoading} />

      <ExecutionAssumptionsPanel />

      <Button size="lg" onClick={handleRun} disabled={submitting || coverage?.policy === "DATA_UNAVAILABLE"}>
        {submitting ? "Submitting..." : "Run Backtest"}
      </Button>
    </div>
  );
}
