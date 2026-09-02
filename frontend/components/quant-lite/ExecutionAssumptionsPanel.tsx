// components/quant-lite/ExecutionAssumptionsPanel.tsx
// Sprint Q0.8 - the single source of truth for Quant Lite's execution
// disclosure copy (quant-engine/reports/Q0.7_EXECUTION_DISCLOSURE.md).
// Reused verbatim on Backtest Setup, Results, and Strategy Detail so the
// wording can never drift between screens - per Q0.7's own UI honesty
// rule, this panel is never hidden behind an extra click on the results
// screen.
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import StatField from "@/components/workspace/StatField";
import type { ExecutionAssumptions } from "@/types/quant-lite";

const DEFAULT_ASSUMPTIONS: ExecutionAssumptions = {
  executionModel: "Quant Lite Canonical Engine",
  spread: "Time-varying real market spread",
  slippage: "Not modeled",
  commission: "Not modeled",
  breakeven: "OFF",
  trailing: "OFF",
  partialClose: "OFF",
  dataSource: "Legacy market data",
};

export default function ExecutionAssumptionsPanel({
  assumptions = DEFAULT_ASSUMPTIONS,
  collapsible = false,
}: {
  assumptions?: ExecutionAssumptions;
  collapsible?: boolean;
}) {
  const body = (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatField label="Execution Model">{assumptions.executionModel}</StatField>
      <StatField label="Spread">{assumptions.spread}</StatField>
      <StatField label="Slippage">{assumptions.slippage}</StatField>
      <StatField label="Commission">{assumptions.commission}</StatField>
      <StatField label="Data Source">{assumptions.dataSource}</StatField>
      <div className="flex flex-wrap items-start gap-1.5">
        <Badge tone="neutral">Breakeven {assumptions.breakeven}</Badge>
        <Badge tone="neutral">Trailing {assumptions.trailing}</Badge>
        <Badge tone="neutral">Partial Close {assumptions.partialClose}</Badge>
      </div>
    </div>
  );

  if (!collapsible) {
    return (
      <Card>
        <p className="mb-3 text-sm font-semibold text-text">Quant Lite Execution Model</p>
        {body}
        <p className="mt-4 text-xs text-text-3">
          Breakeven, ATR trailing, and partial close are frozen off for Quant Lite - this matches the
          position management (or lack of it) in the MQL5/MQL4/Pine Script code this strategy would
          generate. Tick-level execution is not modeled; stop-loss and take-profit are resolved with
          1-minute precision instead.
        </p>
      </Card>
    );
  }

  return (
    <details className="rounded-card border border-border bg-ink-2 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-text">How this backtest works</summary>
      <div className="mt-3">{body}</div>
    </details>
  );
}
