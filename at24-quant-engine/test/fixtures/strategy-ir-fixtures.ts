import type { Instrument, Timeframe } from "../../src/domain/market-data.js";
import { indicator } from "../../src/domain/indicator-reference.js";
import { comparison, indicatorOperand, literal, seriesOperand } from "../../src/domain/expression.js";
import type { StrategyIR } from "../../src/domain/strategy-ir/strategy-ir.js";
import type { EntryIR, ExitIR } from "../../src/domain/strategy-ir/entry-exit-ir.js";
import type { SourcePlatform } from "../../src/domain/strategy-ir/source.js";
import { STRATEGY_IR_VERSION } from "../../src/domain/strategy-ir/version.js";
import type { RiskSpecification } from "../../src/domain/risk-specification.js";
import type { ExecutionSpecification } from "../../src/domain/execution-specification.js";

export const IR_INSTRUMENT: Instrument = { symbol: "IRFIXTURE", assetClass: "other" };
export const IR_TIMEFRAME: Timeframe = "H1";
const BASE_TS = Date.parse("2026-01-05T00:00:00Z");

const DEFAULT_EXECUTION: ExecutionSpecification = { fillModel: "next-bar-open", costsExplicitlyZero: true };
const DEFAULT_RISK: RiskSpecification = { sizing: { method: "fixed-quantity", quantity: 1 } };

function defaultEntry(id = "entry-1"): EntryIR {
  return {
    id,
    direction: "BUY",
    // A plain price-series condition (no indicator reference) so fixtures
    // that don't override `entries` never trip the "unknown indicator"
    // check just from inheriting this default (declared `indicators`
    // varies per fixture; this default must work with an empty array too).
    condition: comparison(">", seriesOperand("CLOSE", 0), literal(0)),
    sizingModel: { method: "fixed-quantity", quantity: 1 },
    timing: "NEXT_BAR_OPEN",
    executionType: "MARKET",
  };
}

/** Every required field, filled with a minimal, structurally-valid default — each of the 24 fixtures below overrides only what makes it distinctive. */
function baseIR(overrides: Partial<StrategyIR> = {}): StrategyIR {
  const sourcePlatform: SourcePlatform = overrides.sourcePlatform ?? "AT24_NATIVE";
  return {
    strategyId: "ir-fixture",
    strategyVersion: "1.0.0",
    sourcePlatform,
    sourceLanguage: "AT24-native",
    sourceVersion: "1.0.0",
    sourceHash: "0".repeat(64),
    irVersion: STRATEGY_IR_VERSION,
    metadata: { name: "IR Fixture", createdAt: BASE_TS },
    instruments: [IR_INSTRUMENT],
    timeframes: [IR_TIMEFRAME],
    timeframeSeries: [{ timeframe: IR_TIMEFRAME, role: "EXECUTION", availabilityPolicy: "HTF_CLOSE_AVAILABLE", alignmentPolicy: "CLOSE_ALIGNED" }],
    parameters: [],
    indicators: [],
    conditions: [],
    entries: [defaultEntry()],
    exits: [],
    positionManagement: {
      accountingMode: "NETTING",
      pyramiding: { allowPyramiding: false, sameDirectionBehavior: "REJECT", oppositeDirectionBehavior: "REVERSAL" },
      reversal: { buyToSell: "CLOSE_THEN_OPEN", sellToBuy: "CLOSE_THEN_OPEN" },
    },
    timezone: { strategyTimezone: "UTC" },
    repaintingModel: "NON_REPAINTING",
    realtimeHistoricalAsymmetry: { historicalVsRealtimeDiffers: false, barCloseVsIntrabarDiffers: false },
    barCloseSemantics: "ON_BAR_CLOSE",
    priceSource: "CLOSE",
    slTpReference: "SIGNAL_BAR_CLOSE",
    risk: DEFAULT_RISK,
    execution: { declared: DEFAULT_EXECUTION, platformDefaultsUsed: [] },
    dependencies: { symbols: [], timeframes: [] },
    provenance: {
      sourcePlatform,
      sourceHash: "0".repeat(64),
      sourceVersion: "1.0.0",
      irVersion: STRATEGY_IR_VERSION,
      translationHash: "0".repeat(64),
      semanticStatus: "EXACT",
      unsupportedSemantics: [],
      approximations: [],
    },
    ...overrides,
  };
}

// 1. Simple SMA strategy
export function fixtureSimpleSMA(): StrategyIR {
  const sma = indicator("SMA", 20);
  return baseIR({
    strategyId: "fixture-01-simple-sma",
    metadata: { name: "Simple SMA", createdAt: BASE_TS },
    indicators: [{ kind: "named", family: "SMA", params: [20] }],
    entries: [{ id: "entry-1", direction: "BUY", condition: comparison(">", seriesOperand("CLOSE", 0), indicatorOperand(sma)), sizingModel: { method: "fixed-quantity", quantity: 1 }, timing: "NEXT_BAR_OPEN", executionType: "MARKET" }],
  });
}

// 2. EMA crossover
export function fixtureEMACrossover(): StrategyIR {
  const fast = indicator("EMA", 9);
  const slow = indicator("EMA", 21);
  return baseIR({
    strategyId: "fixture-02-ema-crossover",
    metadata: { name: "EMA Crossover", createdAt: BASE_TS },
    indicators: [{ kind: "named", family: "EMA", params: [9] }, { kind: "named", family: "EMA", params: [21] }],
    entries: [{ id: "entry-1", direction: "BUY", condition: comparison("cross_above", indicatorOperand(fast), indicatorOperand(slow)), sizingModel: { method: "fixed-quantity", quantity: 1 }, timing: "NEXT_BAR_OPEN", executionType: "MARKET" }],
    exits: [{ id: "exit-1", kind: "SIGNAL_EXIT", condition: comparison("cross_below", indicatorOperand(fast), indicatorOperand(slow)) }],
  });
}

// 3. RSI strategy
export function fixtureRSI(): StrategyIR {
  const rsi = indicator("RSI", 14);
  return baseIR({
    strategyId: "fixture-03-rsi",
    metadata: { name: "RSI Oversold", createdAt: BASE_TS },
    indicators: [{ kind: "named", family: "RSI", params: [14] }],
    entries: [{ id: "entry-1", direction: "BUY", condition: comparison("<", indicatorOperand(rsi), literal(30)), sizingModel: { method: "fixed-quantity", quantity: 1 }, timing: "NEXT_BAR_OPEN", executionType: "MARKET" }],
  });
}

// 4. ATR SL/TP
export function fixtureATRSLTP(): StrategyIR {
  return baseIR({
    strategyId: "fixture-04-atr-sl-tp",
    metadata: { name: "ATR-Based Stops", createdAt: BASE_TS },
    indicators: [{ kind: "named", family: "ATR", params: [14] }],
    risk: { sizing: { method: "fixed-quantity", quantity: 1 }, stopLoss: { type: "atr-multiple", atrMultiple: 2, atrPeriod: 14 }, takeProfit: { type: "risk-multiple", rMultiple: 2 } },
    slTpReference: "ATR_DERIVED",
  });
}

// 5. MTF strategy
export function fixtureMTF(): StrategyIR {
  return baseIR({
    strategyId: "fixture-05-mtf",
    metadata: { name: "H1 Execution / H4 Filter", createdAt: BASE_TS },
    timeframeSeries: [
      { timeframe: "H1", role: "EXECUTION", availabilityPolicy: "HTF_CLOSE_AVAILABLE", alignmentPolicy: "CLOSE_ALIGNED" },
      { timeframe: "H4", role: "HIGHER", availabilityPolicy: "HTF_CLOSE_AVAILABLE", alignmentPolicy: "CLOSE_ALIGNED" },
    ],
    dependencies: { symbols: [], timeframes: ["H4"] },
  });
}

// 6. Session strategy
export function fixtureSession(): StrategyIR {
  return baseIR({
    strategyId: "fixture-06-session",
    metadata: { name: "London Session Only", createdAt: BASE_TS },
    session: { sessionHours: { timezone: "Europe/London", windows: [{ startHour: 8, startMinute: 0, endHour: 16, endMinute: 30 }] }, sessionExitBehavior: "CLOSE_ALL" },
    timezone: { strategyTimezone: "Europe/London", exchangeTimezone: "Europe/London" },
  });
}

// 7. Pyramiding
export function fixturePyramiding(): StrategyIR {
  return baseIR({
    strategyId: "fixture-07-pyramiding",
    metadata: { name: "Pyramiding Accumulator", createdAt: BASE_TS },
    positionManagement: {
      accountingMode: "NETTING",
      pyramiding: { allowPyramiding: true, maxPositions: 3, maxEntries: 3, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" },
      reversal: { buyToSell: "REVERSE", sellToBuy: "REVERSE" },
    },
  });
}

// 8. Reversal
export function fixtureReversal(): StrategyIR {
  return baseIR({
    strategyId: "fixture-08-reversal",
    metadata: { name: "Always-In Reversal", createdAt: BASE_TS },
    positionManagement: {
      accountingMode: "NETTING",
      pyramiding: { allowPyramiding: false, sameDirectionBehavior: "REJECT", oppositeDirectionBehavior: "REVERSAL" },
      reversal: { buyToSell: "REVERSE", sellToBuy: "REVERSE", platformDefaultDescription: "MT5 netting-mode reversal: an opposite-signal fill reduces/reverses the existing position in one operation" },
    },
  });
}

// 9. Limit order
export function fixtureLimitOrder(): StrategyIR {
  return baseIR({
    strategyId: "fixture-09-limit-order",
    metadata: { name: "Limit Entry", createdAt: BASE_TS },
    entries: [{ id: "entry-1", direction: "BUY", condition: comparison(">", seriesOperand("CLOSE", 0), literal(0)), sizingModel: { method: "fixed-quantity", quantity: 1 }, timing: "NEXT_BAR_OPEN", executionType: "LIMIT" }],
  });
}

// 10. Stop order
export function fixtureStopOrder(): StrategyIR {
  return baseIR({
    strategyId: "fixture-10-stop-order",
    metadata: { name: "Breakout Stop Entry", createdAt: BASE_TS },
    entries: [{ id: "entry-1", direction: "BUY", condition: comparison(">", seriesOperand("CLOSE", 0), literal(0)), sizingModel: { method: "fixed-quantity", quantity: 1 }, timing: "NEXT_BAR_OPEN", executionType: "STOP" }],
  });
}

// 11. Stop-limit
export function fixtureStopLimitOrder(): StrategyIR {
  return baseIR({
    strategyId: "fixture-11-stop-limit",
    metadata: { name: "Bounded Breakout Entry", createdAt: BASE_TS },
    entries: [{ id: "entry-1", direction: "BUY", condition: comparison(">", seriesOperand("CLOSE", 0), literal(0)), sizingModel: { method: "fixed-quantity", quantity: 1 }, timing: "NEXT_BAR_OPEN", executionType: "STOP_LIMIT" }],
  });
}

// 12. Trailing
export function fixtureTrailing(): StrategyIR {
  return baseIR({
    strategyId: "fixture-12-trailing",
    metadata: { name: "Trailing Stop", createdAt: BASE_TS },
    risk: { sizing: { method: "fixed-quantity", quantity: 1 }, trailingStop: { activation: { mode: "absolute", value: 10 }, distance: { mode: "absolute", value: 5 } } },
  });
}

// 13. Breakeven
export function fixtureBreakeven(): StrategyIR {
  return baseIR({
    strategyId: "fixture-13-breakeven",
    metadata: { name: "Breakeven Stop Move", createdAt: BASE_TS },
    risk: { sizing: { method: "fixed-quantity", quantity: 1 }, breakeven: { trigger: { mode: "absolute", value: 10 }, lockOffset: { mode: "absolute", value: 1 } } },
  });
}

// 14. Partial close
export function fixturePartialClose(): StrategyIR {
  return baseIR({
    strategyId: "fixture-14-partial-close",
    metadata: { name: "Partial Close at 1R", createdAt: BASE_TS },
    risk: { sizing: { method: "fixed-quantity", quantity: 2 }, partialClose: { trigger: { mode: "absolute", value: 10 }, closePercent: 50 } },
  });
}

// 15. Pine request.security
export function fixturePineRequestSecurity(): StrategyIR {
  return baseIR({
    strategyId: "fixture-15-pine-request-security",
    sourceHash: "1".repeat(64),
    sourcePlatform: "TRADINGVIEW_PINE",
    sourceLanguage: "Pine Script v5",
    metadata: { name: "HTF Filter via request.security", createdAt: BASE_TS },
    timeframeSeries: [
      { timeframe: "H1", role: "EXECUTION", availabilityPolicy: "HTF_CLOSE_AVAILABLE", alignmentPolicy: "CLOSE_ALIGNED" },
      { timeframe: "D1", role: "HIGHER", availabilityPolicy: "HTF_CLOSE_AVAILABLE", alignmentPolicy: "CLOSE_ALIGNED" },
    ],
    requestSecurityCalls: [{ sourceTimeframe: "H1", requestedTimeframe: "D1", lookahead: "OFF", gapsFilled: false, confirmedOnly: true }],
    provenance: {
      sourcePlatform: "TRADINGVIEW_PINE",
      sourceHash: "1".repeat(64),
      sourceVersion: "5",
      irVersion: STRATEGY_IR_VERSION,
      translationHash: "1".repeat(64),
      semanticStatus: "SEMANTIC_EQUIVALENT",
      unsupportedSemantics: [],
      approximations: [],
    },
  });
}

// 16. MQL4 order flow
export function fixtureMQL4OrderFlow(): StrategyIR {
  return baseIR({
    strategyId: "fixture-16-mql4-order-flow",
    sourceHash: "2".repeat(64),
    sourcePlatform: "MT4_MQL4",
    sourceLanguage: "MQL4",
    metadata: { name: "OrderSend/OrderClose Flow", createdAt: BASE_TS },
    positionManagement: {
      accountingMode: "HEDGING",
      pyramiding: { allowPyramiding: true, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "IGNORE" },
      reversal: { buyToSell: "REJECT", sellToBuy: "REJECT", platformDefaultDescription: "MT4 hedging: opposite-direction orders coexist as independent tickets, never automatically reverse" },
    },
    provenance: {
      sourcePlatform: "MT4_MQL4",
      sourceHash: "2".repeat(64),
      sourceVersion: "4",
      irVersion: STRATEGY_IR_VERSION,
      translationHash: "2".repeat(64),
      semanticStatus: "EXACT",
      unsupportedSemantics: [],
      approximations: [],
    },
  });
}

// 17. MQL5 netting
export function fixtureMQL5Netting(): StrategyIR {
  return baseIR({
    strategyId: "fixture-17-mql5-netting",
    sourceHash: "3".repeat(64),
    sourcePlatform: "MT5_MQL5",
    sourceLanguage: "MQL5",
    metadata: { name: "CTrade Netting Flow", createdAt: BASE_TS },
    positionManagement: {
      accountingMode: "NETTING",
      pyramiding: { allowPyramiding: false, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" },
      reversal: { buyToSell: "REVERSE", sellToBuy: "REVERSE" },
    },
    provenance: {
      sourcePlatform: "MT5_MQL5",
      sourceHash: "3".repeat(64),
      sourceVersion: "5",
      irVersion: STRATEGY_IR_VERSION,
      translationHash: "3".repeat(64),
      semanticStatus: "EXACT",
      unsupportedSemantics: [],
      approximations: [],
    },
  });
}

// 18. MT5 hedging
export function fixtureMT5Hedging(): StrategyIR {
  return baseIR({
    strategyId: "fixture-18-mt5-hedging",
    sourceHash: "4".repeat(64),
    sourcePlatform: "MT5_MQL5",
    sourceLanguage: "MQL5",
    metadata: { name: "MT5 Hedging-Mode Account", createdAt: BASE_TS },
    positionManagement: {
      accountingMode: "HEDGING",
      pyramiding: { allowPyramiding: true, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "IGNORE" },
      reversal: { buyToSell: "REJECT", sellToBuy: "REJECT", platformDefaultDescription: "MT5 hedging mode: independent positions per ticket, same as MT4's model but opt-in per account" },
    },
    provenance: {
      sourcePlatform: "MT5_MQL5",
      sourceHash: "4".repeat(64),
      sourceVersion: "5",
      irVersion: STRATEGY_IR_VERSION,
      translationHash: "4".repeat(64),
      semanticStatus: "EXACT",
      unsupportedSemantics: [],
      approximations: [],
    },
  });
}

// 19. Ninja multi-series
export function fixtureNinjaMultiSeries(): StrategyIR {
  return baseIR({
    strategyId: "fixture-19-ninja-multi-series",
    sourceHash: "5".repeat(64),
    sourcePlatform: "NINJATRADER_NINJASCRIPT",
    sourceLanguage: "C# (NinjaScript)",
    metadata: { name: "BarsInProgress Multi-Series", createdAt: BASE_TS },
    timeframeSeries: [
      { timeframe: "M5", role: "EXECUTION", availabilityPolicy: "HTF_CLOSE_AVAILABLE", alignmentPolicy: "CLOSE_ALIGNED" },
      { timeframe: "M1", role: "LOWER", availabilityPolicy: "HTF_CLOSE_AVAILABLE", alignmentPolicy: "CLOSE_ALIGNED" },
    ],
    dependencies: { symbols: [], timeframes: ["M1"] },
    provenance: {
      sourcePlatform: "NINJATRADER_NINJASCRIPT",
      sourceHash: "5".repeat(64),
      sourceVersion: "8",
      irVersion: STRATEGY_IR_VERSION,
      translationHash: "5".repeat(64),
      semanticStatus: "SEMANTIC_EQUIVALENT",
      unsupportedSemantics: [],
      approximations: [],
    },
  });
}

// 20. cBot order lifecycle
export function fixtureCBotOrderLifecycle(): StrategyIR {
  return baseIR({
    strategyId: "fixture-20-cbot-order-lifecycle",
    sourceHash: "6".repeat(64),
    sourcePlatform: "CTRADER_CBOT",
    sourceLanguage: "C# (cAlgo.API)",
    metadata: { name: "ExecuteMarketOrder/ModifyPosition Flow", createdAt: BASE_TS },
    positionManagement: {
      accountingMode: "NETTING",
      pyramiding: { allowPyramiding: false, sameDirectionBehavior: "REJECT", oppositeDirectionBehavior: "REVERSAL" },
      reversal: { buyToSell: "CLOSE_THEN_OPEN", sellToBuy: "CLOSE_THEN_OPEN" },
    },
    provenance: {
      sourcePlatform: "CTRADER_CBOT",
      sourceHash: "6".repeat(64),
      sourceVersion: "1",
      irVersion: STRATEGY_IR_VERSION,
      translationHash: "6".repeat(64),
      semanticStatus: "EXACT",
      unsupportedSemantics: [],
      approximations: [],
    },
  });
}

// 21. AI-generated strategy — built via the real compiler, not hand-assembled (see strategy-ir-ai-boundary.test.ts for the compiler call itself)
export function fixtureAIGeneratedShape(): Pick<StrategyIR, "sourcePlatform" | "provenance"> {
  return { sourcePlatform: "AI_GENERATED", provenance: baseIR({ sourcePlatform: "AI_GENERATED" }).provenance };
}

// 22. Unsupported semantic
export function fixtureUnsupportedSemantic(): StrategyIR {
  return baseIR({
    strategyId: "fixture-22-unsupported-semantic",
    sourceHash: "7".repeat(64),
    sourcePlatform: "MT4_MQL4",
    sourceLanguage: "MQL4",
    metadata: { name: "Custom Indicator Formula (Unsupported)", createdAt: BASE_TS },
    indicators: [{ kind: "generic", name: "CustomWaveIndicator", parameters: [7, "close"], inputs: ["close"], outputFields: ["value"] }],
    provenance: {
      sourcePlatform: "MT4_MQL4",
      sourceHash: "7".repeat(64),
      sourceVersion: "4",
      irVersion: STRATEGY_IR_VERSION,
      translationHash: "7".repeat(64),
      semanticStatus: "UNSUPPORTED",
      unsupportedSemantics: [
        {
          feature: "CustomWaveIndicator (proprietary, undocumented formula)",
          reason: "no matching NamedIndicatorFamily and no published formula to reduce to a generic IndicatorCall's outputFields deterministically",
          severity: "BLOCKING",
          executionImpact: "any condition referencing this indicator's output cannot be evaluated by the simulation engine",
        },
      ],
      approximations: [],
    },
  });
}

// 23. Repainting strategy
export function fixtureRepainting(): StrategyIR {
  return baseIR({
    strategyId: "fixture-23-repainting",
    sourceHash: "8".repeat(64),
    sourcePlatform: "TRADINGVIEW_PINE",
    sourceLanguage: "Pine Script v5",
    metadata: { name: "Unconfirmed request.security Read", createdAt: BASE_TS },
    repaintingModel: "REPAINTING",
    realtimeHistoricalAsymmetry: { historicalVsRealtimeDiffers: true, barCloseVsIntrabarDiffers: true, note: "reads an unconfirmed HTF value that changes retroactively once the HTF bar closes" },
    requestSecurityCalls: [{ sourceTimeframe: "H1", requestedTimeframe: "D1", lookahead: "ON", gapsFilled: false, confirmedOnly: false }],
    provenance: {
      sourcePlatform: "TRADINGVIEW_PINE",
      sourceHash: "8".repeat(64),
      sourceVersion: "5",
      irVersion: STRATEGY_IR_VERSION,
      translationHash: "8".repeat(64),
      semanticStatus: "UNSUPPORTED",
      unsupportedSemantics: [
        { feature: "request.security(..., lookahead=barmerge.lookahead_on)", reason: "unsafe HTF lookahead direction — never executed by AT24 (Q0.4_LOOKAHEAD_REPAINTING.md)", severity: "BLOCKING", executionImpact: "strategy cannot be validated for execution until rewritten with a confirmed-only HTF read" },
      ],
      approximations: [],
    },
  });
}

// 24. Timezone-sensitive strategy
export function fixtureTimezoneSensitive(): StrategyIR {
  return baseIR({
    strategyId: "fixture-24-timezone-sensitive",
    metadata: { name: "NY Session, Exchange-Timezone SL/TP", createdAt: BASE_TS },
    session: { sessionHours: { timezone: "America/New_York", windows: [{ startHour: 9, startMinute: 30, endHour: 16, endMinute: 0 }] }, sessionExitBehavior: "CLOSE_ALL" },
    timezone: { strategyTimezone: "America/New_York", exchangeTimezone: "America/New_York", dataTimezone: "UTC" },
  });
}

export const ALL_GOLDEN_IR_FIXTURES: readonly (() => StrategyIR)[] = [
  fixtureSimpleSMA,
  fixtureEMACrossover,
  fixtureRSI,
  fixtureATRSLTP,
  fixtureMTF,
  fixtureSession,
  fixturePyramiding,
  fixtureReversal,
  fixtureLimitOrder,
  fixtureStopOrder,
  fixtureStopLimitOrder,
  fixtureTrailing,
  fixtureBreakeven,
  fixturePartialClose,
  fixturePineRequestSecurity,
  fixtureMQL4OrderFlow,
  fixtureMQL5Netting,
  fixtureMT5Hedging,
  fixtureNinjaMultiSeries,
  fixtureCBotOrderLifecycle,
  fixtureUnsupportedSemantic,
  fixtureRepainting,
  fixtureTimezoneSensitive,
];
