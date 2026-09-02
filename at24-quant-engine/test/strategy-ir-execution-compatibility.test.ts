import { test } from "node:test";
import assert from "node:assert/strict";
import { computeExecutionCompatibility } from "../src/runtime/strategy-ir/execution-compatibility-engine.js";
import { fixtureSimpleSMA, fixtureATRSLTP, fixtureEMACrossover, fixtureMT5Hedging, fixtureMTF, fixtureRepainting } from "./fixtures/strategy-ir-fixtures.js";

test("a plain market-order SMA strategy is fully SUPPORTED against D1_OHLC", () => {
  const report = computeExecutionCompatibility(fixtureSimpleSMA(), "D1_OHLC");
  assert.equal(report.overallStatus, "SUPPORTED");
});

test("ATR-based position sizing is UNSUPPORTED — matches Q0.5's documented resolvePositionSize() limitation exactly", () => {
  const ir = fixtureATRSLTP();
  const irWithAtrSizing = { ...ir, entries: ir.entries.map((e) => ({ ...e, sizingModel: { method: "atr-based" as const, atrMultiple: 2, atrPeriod: 14 } })) };
  const report = computeExecutionCompatibility(irWithAtrSizing, "D1_OHLC");
  const atrFeature = report.features.find((f) => f.feature.includes("atr-based"));
  assert.ok(atrFeature);
  assert.equal(atrFeature.status, "UNSUPPORTED");
  assert.equal(report.overallStatus, "UNSUPPORTED");
});

test("Q1.5.3: SIGNAL_EXIT with a real condition is SUPPORTED — exitRules ARE genuinely evaluated since Q1.5.3 (previously UNSUPPORTED pre-Q1.5, when they were accepted but never evaluated; see docs/Q1.5_EXIT_CONTRACT.md)", () => {
  const report = computeExecutionCompatibility(fixtureEMACrossover(), "D1_OHLC");
  const signalExit = report.features.find((f) => f.feature.includes("SIGNAL_EXIT"));
  assert.ok(signalExit);
  assert.equal(signalExit.status, "SUPPORTED");
});

test("Q1.5.3: SIGNAL_EXIT with NO condition remains UNSUPPORTED — nothing to evaluate", () => {
  const ir = fixtureEMACrossover();
  const withoutCondition = {
    ...ir,
    exits: ir.exits.map((e) => {
      if (e.kind !== "SIGNAL_EXIT") return e;
      const { condition: _condition, ...rest } = e;
      return rest;
    }),
  };
  const report = computeExecutionCompatibility(withoutCondition, "D1_OHLC");
  const signalExit = report.features.find((f) => f.feature.includes("SIGNAL_EXIT"));
  assert.ok(signalExit);
  assert.equal(signalExit.status, "UNSUPPORTED");
});

test("HEDGING accounting mode is UNSUPPORTED against AT24's engine — matches Q0.5's NETTING-only implementation exactly", () => {
  const report = computeExecutionCompatibility(fixtureMT5Hedging(), "D1_OHLC");
  const accounting = report.features.find((f) => f.feature.startsWith("position accounting mode"));
  assert.ok(accounting);
  assert.equal(accounting.status, "UNSUPPORTED");
});

test("a LOWER-role timeframeSeries is UNSUPPORTED against D1_OHLC but SUPPORTED against D2_LOWER_TIMEFRAME (Q0.6's own capability)", () => {
  const ir = fixtureSimpleSMA();
  const withLower = { ...ir, timeframeSeries: [...ir.timeframeSeries, { timeframe: "M15" as const, role: "LOWER" as const, availabilityPolicy: "HTF_CLOSE_AVAILABLE" as const, alignmentPolicy: "CLOSE_ALIGNED" as const }] };
  const d1Report = computeExecutionCompatibility(withLower, "D1_OHLC");
  const d2Report = computeExecutionCompatibility(withLower, "D2_LOWER_TIMEFRAME");
  assert.equal(d1Report.features.find((f) => f.feature.includes("role LOWER"))!.status, "UNSUPPORTED");
  assert.equal(d2Report.features.find((f) => f.feature.includes("role LOWER"))!.status, "SUPPORTED");
});

test("a HIGHER-role timeframeSeries (genuine dual-timeframe strategy calc) is UNSUPPORTED regardless of fidelity", () => {
  const d1Report = computeExecutionCompatibility(fixtureMTF(), "D1_OHLC");
  const d3Report = computeExecutionCompatibility(fixtureMTF(), "D3_M1");
  assert.equal(d1Report.features.find((f) => f.feature.includes("role HIGHER"))!.status, "UNSUPPORTED");
  assert.equal(d3Report.features.find((f) => f.feature.includes("role HIGHER"))!.status, "UNSUPPORTED");
});

test("a REPAINTING strategy is BLOCKED overall, regardless of every other feature's status", () => {
  const report = computeExecutionCompatibility(fixtureRepainting(), "D1_OHLC");
  assert.equal(report.overallStatus, "BLOCKED");
});
