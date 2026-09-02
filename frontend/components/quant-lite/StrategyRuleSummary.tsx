// components/quant-lite/StrategyRuleSummary.tsx
// Sprint Q0.8 - renders a StrategySpec human-readably (Screens 5/6/7 all
// need this - "the actual rules, rendered readably, not just raw JSON"
// per Q0.7_UI_INFORMATION_ARCHITECTURE.md Screen 7).
import { CONDITION_OP_LABELS, INDICATOR_META } from "@/data/quant-lite-constants";
import type { ConditionSpec, IndicatorSpec, StrategySpec } from "@/types/quant-lite";

function refLabel(ref: string | number, indicators: IndicatorSpec[]): string {
  if (typeof ref === "number") return String(ref);
  if (ref === "close" || ref === "open" || ref === "high" || ref === "low") return ref;
  const [id, field] = ref.split(".");
  const ind = indicators.find((i) => i.id === id);
  if (!ind) return ref;
  const meta = INDICATOR_META[ind.type];
  const output = meta.outputs.find((o) => o.suffix === (field ? `.${field}` : ""));
  return `${meta.label}${output && output.label !== "Value" ? ` (${output.label})` : ""}`;
}

function ConditionLine({ condition, indicators }: { condition: ConditionSpec; indicators: IndicatorSpec[] }) {
  return (
    <li>
      {refLabel(condition.left, indicators)} <span className="text-text-3">{CONDITION_OP_LABELS[condition.op]}</span>{" "}
      {refLabel(condition.right, indicators)}
    </li>
  );
}

export default function StrategyRuleSummary({ spec }: { spec: StrategySpec }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-text-3">Market / Timeframe</p>
        <p className="mt-1 text-text">
          {spec.symbol} &middot; {spec.timeframe}
        </p>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-text-3">Indicators</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-text-2">
          {spec.indicators.map((ind) => (
            <li key={ind.id}>
              {INDICATOR_META[ind.type]?.label ?? ind.type}
              {ind.period !== undefined ? ` (${ind.period})` : ""}
            </li>
          ))}
        </ul>
      </div>

      {spec.entry_long.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-3">
            Buy when <span className="normal-case">(all conditions must be true)</span>
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-text-2">
            {spec.entry_long.map((c, i) => (
              <ConditionLine key={i} condition={c} indicators={spec.indicators} />
            ))}
          </ul>
        </div>
      )}

      {spec.entry_short.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-3">
            Sell when <span className="normal-case">(all conditions must be true)</span>
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-text-2">
            {spec.entry_short.map((c, i) => (
              <ConditionLine key={i} condition={c} indicators={spec.indicators} />
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-text-3">Exit</p>
        <p className="mt-1 text-text-2">
          SL: {spec.risk.sl_mode === "ATR" ? `${spec.risk.sl_atr_mult}x ATR` : `${spec.risk.sl_points} price units`} &middot; TP:{" "}
          {spec.risk.tp_mode === "ATR" ? `${spec.risk.tp_atr_mult}x ATR` : `${spec.risk.tp_points} price units`}
        </p>
      </div>
    </div>
  );
}
