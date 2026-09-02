"use client";
// app/quant-lite/builder/StrategyBuilderForm.tsx
// Sprint Q0.8 - the interactive Strategy Builder. Establishes this
// codebase's first multi-section form pattern (none existed previously -
// confirmed in the Q0.8 architecture audit) using only existing
// primitives (Input/Select/Button/Card), deliberately not introducing a
// new form library.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Badge from "@/components/ui/Badge";
import StrategyRuleSummary from "@/components/quant-lite/StrategyRuleSummary";
import ExecutionAssumptionsPanel from "@/components/quant-lite/ExecutionAssumptionsPanel";
import { INDICATOR_META, RISK_PRESETS, TIMEFRAME_LABELS } from "@/data/quant-lite-constants";
import { QUANT_LITE_CAPABILITY } from "@/data/quant-lite-capability";
import { saveDraftSpec } from "@/services/quant-lite/QuantLiteBacktestService";
import { validateStrategySpec } from "@/services/quant-lite/validateStrategySpec";
import {
  SUPPORTED_CONDITION_OPS,
  SUPPORTED_INDICATOR_TYPES,
  type ConditionOp,
  type ConditionSpec,
  type IndicatorSpec,
  type IndicatorType,
  type RiskSpec,
  type StrategySpec,
} from "@/types/quant-lite";
import { CONDITION_OP_LABELS } from "@/data/quant-lite-constants";

let idCounter = 0;
function nextId(type: IndicatorType) {
  idCounter += 1;
  return `${type.toLowerCase()}${idCounter}`;
}

function availableRefs(indicators: IndicatorSpec[]): Array<{ value: string; label: string }> {
  const refs = [
    { value: "close", label: "Close price" },
    { value: "open", label: "Open price" },
    { value: "high", label: "High price" },
    { value: "low", label: "Low price" },
  ];
  for (const ind of indicators) {
    const meta = INDICATOR_META[ind.type];
    for (const output of meta.outputs) {
      refs.push({ value: `${ind.id}${output.suffix}`, label: `${meta.label}${output.label !== "Value" ? ` - ${output.label}` : ""}` });
    }
  }
  return refs;
}

function ConditionRow({
  condition,
  indicators,
  onChange,
  onRemove,
}: {
  condition: ConditionSpec;
  indicators: IndicatorSpec[];
  onChange: (c: ConditionSpec) => void;
  onRemove: () => void;
}) {
  const refs = availableRefs(indicators);
  const rightIsNumber = typeof condition.right === "number";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-ink px-3 py-2">
      <Select value={String(condition.left)} onChange={(e) => onChange({ ...condition, left: e.target.value })}>
        {refs.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      <Select value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value as ConditionOp })}>
        {SUPPORTED_CONDITION_OPS.map((op) => (
          <option key={op} value={op}>
            {CONDITION_OP_LABELS[op]}
          </option>
        ))}
      </Select>
      <Select
        value={rightIsNumber ? "__number__" : String(condition.right)}
        onChange={(e) => {
          if (e.target.value === "__number__") onChange({ ...condition, right: 0 });
          else onChange({ ...condition, right: e.target.value });
        }}
      >
        <option value="__number__">A fixed number</option>
        {refs.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      {rightIsNumber && (
        <Input
          type="number"
          className="w-24"
          value={condition.right as number}
          onChange={(e) => onChange({ ...condition, right: Number(e.target.value) })}
        />
      )}
      <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove condition">
        Remove
      </Button>
    </div>
  );
}

export default function StrategyBuilderForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState<string>(QUANT_LITE_CAPABILITY[0].symbol);
  const [timeframe, setTimeframe] = useState<keyof typeof TIMEFRAME_LABELS>("1h");

  const capabilityEntry = QUANT_LITE_CAPABILITY.find((c) => c.symbol === symbol) ?? QUANT_LITE_CAPABILITY[0];

  function handleSymbolChange(nextSymbol: string) {
    setSymbol(nextSymbol);
    const nextEntry = QUANT_LITE_CAPABILITY.find((c) => c.symbol === nextSymbol);
    if (nextEntry && !nextEntry.timeframes.includes(timeframe)) {
      setTimeframe(nextEntry.timeframes[0] as keyof typeof TIMEFRAME_LABELS);
    }
  }
  const [indicators, setIndicators] = useState<IndicatorSpec[]>([]);
  const [entryLong, setEntryLong] = useState<ConditionSpec[]>([]);
  const [entryShort, setEntryShort] = useState<ConditionSpec[]>([]);
  const [risk, setRisk] = useState<RiskSpec>({
    sl_mode: "PIPS",
    sl_points: 3,
    tp_mode: "PIPS",
    tp_points: 6,
  });
  const [riskPct, setRiskPct] = useState(1.0);
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null);

  const spec: StrategySpec = useMemo(
    () => ({ name, symbol, timeframe, indicators, entry_long: entryLong, entry_short: entryShort, risk }),
    [name, symbol, timeframe, indicators, entryLong, entryShort, risk],
  );

  const atrIndicators = indicators.filter((i) => i.type === "ATR");

  function addIndicator(type: IndicatorType) {
    const meta = INDICATOR_META[type];
    const id = nextId(type);
    const params: Record<string, number> = {};
    for (const p of meta.params) params[p.key] = p.default;
    setIndicators((prev) => [...prev, { id, type, ...params } as IndicatorSpec]);
  }

  function removeIndicator(id: string) {
    setIndicators((prev) => prev.filter((i) => i.id !== id));
  }

  function addCondition(group: "long" | "short") {
    const newCond: ConditionSpec = { left: "close", op: ">", right: 0 };
    if (group === "long") setEntryLong((prev) => [...prev, newCond]);
    else setEntryShort((prev) => [...prev, newCond]);
  }

  function handleValidate() {
    const result = validateStrategySpec(spec);
    setValidation(result);
    return result;
  }

  function handleRunBacktest() {
    const result = handleValidate();
    if (!result.valid) return;
    saveDraftSpec({ spec, riskPct });
    router.push("/quant-lite/backtest");
  }

  return (
    <div className="space-y-8">
      {/* 1. Strategy Information */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-text">1. Strategy Information</h2>
        <label className="block text-xs font-medium text-text-3">Strategy name</label>
        <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. EMA + RSI Trend Strategy" />
      </Card>

      {/* 2 & 3. Market and Timeframe */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-text">2. Market &amp; Timeframe</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-text-3">Market</label>
            <Select className="mt-1 w-full" value={symbol} onChange={(e) => handleSymbolChange(e.target.value)}>
              {QUANT_LITE_CAPABILITY.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.label}
                  {s.status === "CONDITIONALLY_SUPPORTED" ? " (data gaps - see below)" : ""}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-text-3">
              {capabilityEntry.dataSource} - available {capabilityEntry.availableRange.start} to {capabilityEntry.availableRange.end}
            </p>
            {capabilityEntry.dataQualityWarning && (
              <p className="mt-1 rounded-control border border-info/30 bg-info/10 p-2 text-xs text-text-2">{capabilityEntry.dataQualityWarning}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-text-3">Timeframe</label>
            <Select className="mt-1 w-full" value={timeframe} onChange={(e) => setTimeframe(e.target.value as keyof typeof TIMEFRAME_LABELS)}>
              {capabilityEntry.timeframes.map((tf) => (
                <option key={tf} value={tf}>
                  {TIMEFRAME_LABELS[tf as keyof typeof TIMEFRAME_LABELS]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {/* Indicators */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-text">Indicators</h2>
        <div className="flex flex-wrap gap-2">
          {SUPPORTED_INDICATOR_TYPES.map((type) => (
            <Button key={type} variant="secondary" size="sm" onClick={() => addIndicator(type)}>
              + {INDICATOR_META[type].label}
            </Button>
          ))}
        </div>
        {indicators.length > 0 && (
          <ul className="mt-4 space-y-2">
            {indicators.map((ind) => (
              <li key={ind.id} className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-ink px-3 py-2 text-sm">
                <Badge tone="neutral">{ind.id}</Badge>
                <span className="text-text">{INDICATOR_META[ind.type].label}</span>
                {INDICATOR_META[ind.type].params.map((p) => (
                  <label key={p.key} className="flex items-center gap-1 text-xs text-text-3">
                    {p.label}
                    <Input
                      type="number"
                      className="w-16"
                      value={(ind as unknown as Record<string, number>)[p.key] ?? p.default}
                      onChange={(e) =>
                        setIndicators((prev) =>
                          prev.map((i) => (i.id === ind.id ? { ...i, [p.key]: Number(e.target.value) } : i)),
                        )
                      }
                    />
                  </label>
                ))}
                <Button variant="ghost" size="sm" onClick={() => removeIndicator(ind.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 4. Entry Conditions */}
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-text">4. Entry Conditions</h2>
        <p className="mb-3 text-xs text-text-3">All conditions must be true. OR logic is not supported.</p>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-text-3">Buy when</p>
          {entryLong.map((c, i) => (
            <ConditionRow
              key={i}
              condition={c}
              indicators={indicators}
              onChange={(next) => setEntryLong((prev) => prev.map((p, idx) => (idx === i ? next : p)))}
              onRemove={() => setEntryLong((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ))}
          <Button variant="secondary" size="sm" onClick={() => addCondition("long")} disabled={indicators.length === 0}>
            + Add buy condition
          </Button>
        </div>

        <div className="mt-6 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-text-3">Sell when</p>
          {entryShort.map((c, i) => (
            <ConditionRow
              key={i}
              condition={c}
              indicators={indicators}
              onChange={(next) => setEntryShort((prev) => prev.map((p, idx) => (idx === i ? next : p)))}
              onRemove={() => setEntryShort((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ))}
          <Button variant="secondary" size="sm" onClick={() => addCondition("short")} disabled={indicators.length === 0}>
            + Add sell condition
          </Button>
        </div>
      </Card>

      {/* 5. Exit / Risk */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-text">5. Exit &amp; Risk</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-text-3">Stop Loss mode</label>
            <Select
              className="mt-1 w-full"
              value={risk.sl_mode}
              onChange={(e) => setRisk((r) => ({ ...r, sl_mode: e.target.value as "ATR" | "PIPS" }))}
            >
              <option value="PIPS">Fixed price distance</option>
              <option value="ATR">ATR multiple</option>
            </Select>
            {risk.sl_mode === "PIPS" ? (
              <Input
                type="number"
                className="mt-2"
                value={risk.sl_points ?? 3}
                onChange={(e) => setRisk((r) => ({ ...r, sl_points: Number(e.target.value) }))}
              />
            ) : (
              <>
                <Input
                  type="number"
                  className="mt-2"
                  step="0.1"
                  value={risk.sl_atr_mult ?? 2}
                  onChange={(e) => setRisk((r) => ({ ...r, sl_atr_mult: Number(e.target.value) }))}
                />
                <Select className="mt-2 w-full" value={risk.atr_id ?? ""} onChange={(e) => setRisk((r) => ({ ...r, atr_id: e.target.value }))}>
                  <option value="">Select ATR indicator</option>
                  {atrIndicators.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-3">Take Profit mode</label>
            <Select
              className="mt-1 w-full"
              value={risk.tp_mode}
              onChange={(e) => setRisk((r) => ({ ...r, tp_mode: e.target.value as "ATR" | "PIPS" }))}
            >
              <option value="PIPS">Fixed price distance</option>
              <option value="ATR">ATR multiple</option>
            </Select>
            {risk.tp_mode === "PIPS" ? (
              <Input
                type="number"
                className="mt-2"
                value={risk.tp_points ?? 6}
                onChange={(e) => setRisk((r) => ({ ...r, tp_points: Number(e.target.value) }))}
              />
            ) : (
              <Input
                type="number"
                className="mt-2"
                step="0.1"
                value={risk.tp_atr_mult ?? 4}
                onChange={(e) => setRisk((r) => ({ ...r, tp_atr_mult: Number(e.target.value) }))}
              />
            )}
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-text-3">Risk % per trade</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {RISK_PRESETS.map((p) => (
              <Button key={p.key} variant={riskPct === p.riskPct ? "primary" : "secondary"} size="sm" onClick={() => setRiskPct(p.riskPct)}>
                {p.label} ({p.riskPct}%)
              </Button>
            ))}
            <Input type="number" step="0.1" className="w-24" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} />
          </div>
        </div>

        <div className="mt-6">
          <ExecutionAssumptionsPanel />
        </div>
      </Card>

      {/* 6. Strategy Summary */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-text">6. Strategy Summary</h2>
        {name && indicators.length > 0 ? (
          <StrategyRuleSummary spec={spec} />
        ) : (
          <p className="text-sm text-text-3">Fill in the sections above to see a live summary here.</p>
        )}
      </Card>

      {/* 7 & 8. Validation + Run */}
      <Card>
        {validation && !validation.valid && (
          <ul className="mb-4 list-inside list-disc space-y-1 rounded-control border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {validation.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}
        {validation && validation.valid && (
          <p className="mb-4 rounded-control border border-success/30 bg-success/10 p-3 text-sm text-success">
            Strategy is valid and ready to backtest.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={handleValidate}>
            Validate Strategy
          </Button>
          <Button onClick={handleRunBacktest}>Run Backtest</Button>
        </div>
      </Card>
    </div>
  );
}
