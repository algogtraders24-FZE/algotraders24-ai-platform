// components/algo-test/CompiledStrategyCard.tsx
// P4.8-T3.4.1 (docs/P4.8-T3-STRATEGY-LIBRARY.md) - extracted from
// components/chart-engine/AlgoTestPanel.tsx's own original
// CompiledStrategyCard (P4.3), per the explicit "do not create a second
// strategy presentation component" instruction. Moved to its own file
// (not just exported from AlgoTestPanel.tsx) so a genuinely unrelated
// page - the Strategy Library detail page - never has to import from a
// 1300+-line chart-engine client component to render this one card.
//
// Deliberately scoped to ONLY the "a real compiled strategy exists"
// rendering - the original component's three "no strategy" fallback
// branches (never attempted / predates persistence / failed to compile)
// are all genuinely RUN-lifecycle concepts, not Strategy-library
// concepts, and stay in AlgoTestPanel.tsx's own local wrapper, unchanged.
//
// `symbolTimeframeLabel` replaces the original's required `run:
// AlgoTestRunView` prop - the ONE genuinely run-specific input this card
// ever used (run.symbol/.timeframe, never strategy.instruments/
// .timeframes - see AlgoTestCompiledStrategyView's own doc comment on
// why a registry strategy's real StrategySpec can carry an internal
// fixture identity there). Now optional and caller-supplied: AlgoTestPanel
// still passes the real run's symbol/timeframe; the Strategy Library
// detail page (which has no run at all) omits it entirely rather than
// guessing.
import type { AlgoTestCompiledStrategyView } from "@/types/algo-test";
import { FIN_LABEL, FIN_SECONDARY } from "@/components/ui/financial-typography";

export default function CompiledStrategyCard({ strategy, symbolTimeframeLabel }: { strategy: AlgoTestCompiledStrategyView; symbolTimeframeLabel?: string }) {
  return (
    <div className="rounded-control border border-border bg-ink px-2.5 py-2">
      <p className={FIN_LABEL}>Compiled Strategy</p>
      <p className={`${FIN_SECONDARY} mt-1`}>
        {strategy.name} <span className="text-text-3">v{strategy.version}</span>
      </p>
      <dl className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2">
        {symbolTimeframeLabel !== undefined && <Field label="Symbol / Timeframe" value={symbolTimeframeLabel} />}
        <Field label="Position sizing" value={strategy.positionSizing} />
        <Field label="Long entry" value={strategy.longEntry} />
        <Field label="Short entry" value={strategy.shortEntry} />
        <Field label="Exit" value={strategy.exit} span />
        <Field label="Stop loss" value={strategy.stopLoss} />
        <Field label="Take profit" value={strategy.takeProfit} />
      </dl>
      {strategy.parameters.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[11px] text-text-3">Relevant parameters</p>
          <dl className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-4">
            {strategy.parameters.map((p) => (
              <div key={p.key}>
                <dt className="text-text-3">{p.key}</dt>
                <dd className="text-text-2">{String(p.defaultValue)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, span }: { label: string; value: string | undefined; span?: boolean }) {
  return (
    <div className={span ? "sm:col-span-2" : undefined}>
      <dt className="text-text-3">{label}</dt>
      <dd className="text-text-2">{value ?? "—"}</dd>
    </div>
  );
}
