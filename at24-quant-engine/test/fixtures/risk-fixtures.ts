import type { RiskEvaluationInput, RiskEvaluationOutcome, RiskAction, RiskViolationCode } from "../../src/domain/risk-evaluation.js";
import type { Instrument } from "../../src/domain/market-data.js";

/**
 * Deterministic golden fixtures for the Risk Evaluation layer (Q0.3.20).
 * Every fixture states its Input, Expected Result (outcome + action type
 * + violation codes — not the full object, so fixtures stay robust to
 * incidental message-text changes), and Reason.
 */

export const RISK_INSTRUMENT: Instrument = { symbol: "RISKFIXTURE", assetClass: "other" };
const ASOF = Date.parse("2026-06-01T12:00:00Z"); // a Monday, 12:00 UTC

function baseInput(overrides: Partial<RiskEvaluationInput> = {}): RiskEvaluationInput {
  return {
    asOf: ASOF,
    riskSpecification: { sizing: { method: "fixed-lot", lots: 1 } },
    instrument: RISK_INSTRUMENT,
    direction: "BUY",
    portfolio: { openPositionCount: 0 },
    dailyLoss: { realizedPnlToday: 0, equityAtDayStart: 10_000 },
    ...overrides,
  };
}

export interface RiskFixture {
  readonly name: string;
  readonly input: RiskEvaluationInput;
  readonly expectedOutcome: RiskEvaluationOutcome;
  readonly expectedActionType: RiskAction["type"];
  readonly expectedViolationCodes: readonly RiskViolationCode[];
  readonly reason: string;
}

export const RISK_BASIC_BUY: RiskFixture = {
  name: "RISK_BASIC_BUY",
  input: baseInput({
    direction: "BUY",
    proposedEntry: { quantity: 1, entryPrice: 100, stopLoss: 98, takeProfit: 104 },
  }),
  expectedOutcome: "ALLOWED",
  expectedActionType: "ALLOW_ENTRY",
  expectedViolationCodes: [],
  reason: "A well-formed BUY (SL below entry, TP above entry, valid size, no configured limits) has nothing to reject.",
};

export const RISK_BASIC_SELL: RiskFixture = {
  name: "RISK_BASIC_SELL",
  input: baseInput({
    direction: "SELL",
    proposedEntry: { quantity: 1, entryPrice: 100, stopLoss: 102, takeProfit: 96 },
  }),
  expectedOutcome: "ALLOWED",
  expectedActionType: "ALLOW_ENTRY",
  expectedViolationCodes: [],
  reason: "A well-formed SELL (SL above entry, TP below entry) mirrors RISK_BASIC_BUY.",
};

export const RISK_MAX_POSITION: RiskFixture = {
  name: "RISK_MAX_POSITION",
  input: baseInput({
    riskSpecification: { sizing: { method: "fixed-lot", lots: 1 }, maxPositionSize: 5 },
    proposedEntry: { quantity: 10, entryPrice: 100, stopLoss: 98 },
  }),
  expectedOutcome: "REJECTED",
  expectedActionType: "REJECT_ENTRY",
  expectedViolationCodes: ["MAX_POSITION"],
  reason: "Proposed quantity (10) exceeds the configured maxPositionSize (5).",
};

export const RISK_DAILY_LOSS: RiskFixture = {
  name: "RISK_DAILY_LOSS",
  input: baseInput({
    riskSpecification: { sizing: { method: "fixed-lot", lots: 1 }, dailyLossLimit: { mode: "fixed-amount", amount: 500 } },
    dailyLoss: { realizedPnlToday: -600, equityAtDayStart: 10_000 },
    proposedEntry: { quantity: 1, entryPrice: 100, stopLoss: 98 },
  }),
  expectedOutcome: "REJECTED",
  expectedActionType: "REJECT_ENTRY",
  expectedViolationCodes: ["DAILY_LOSS_LIMIT"],
  reason: "Realized loss today ($600) already exceeds the configured $500 daily loss limit.",
};

export const RISK_SESSION: RiskFixture = {
  name: "RISK_SESSION",
  input: baseInput({
    riskSpecification: {
      sizing: { method: "fixed-lot", lots: 1 },
      sessionHours: { timezone: "UTC", windows: [{ startHour: 8, startMinute: 0, endHour: 10, endMinute: 0 }] },
    },
    asOf: Date.parse("2026-06-01T14:00:00Z"), // 14:00 UTC, outside the 08:00-10:00 window
    proposedEntry: { quantity: 1, entryPrice: 100, stopLoss: 98 },
  }),
  expectedOutcome: "REJECTED",
  expectedActionType: "REJECT_ENTRY",
  expectedViolationCodes: ["SESSION_RESTRICTION"],
  reason: "14:00 UTC falls outside the configured 08:00-10:00 UTC session window.",
};

export const RISK_HOLDING: RiskFixture = {
  name: "RISK_HOLDING",
  input: baseInput({
    riskSpecification: { sizing: { method: "fixed-lot", lots: 1 }, maxHoldingPeriod: { maxBars: 10 } },
    existingPosition: {
      quantity: 1,
      entryPrice: 100,
      entryTimestamp: ASOF - 20 * 3_600_000,
      currentPrice: 105,
      barsHeld: 12,
    },
  }),
  expectedOutcome: "REJECTED",
  expectedActionType: "FORCE_EXIT_REQUIRED",
  expectedViolationCodes: ["MAX_HOLDING_PERIOD"],
  reason: "12 bars held >= the configured maxBars of 10.",
};

export const RISK_BREAKEVEN: RiskFixture = {
  name: "RISK_BREAKEVEN",
  input: baseInput({
    riskSpecification: {
      sizing: { method: "fixed-lot", lots: 1 },
      breakeven: { trigger: { mode: "absolute", value: 2 }, lockOffset: { mode: "absolute", value: 0.1 } },
    },
    existingPosition: { quantity: 1, entryPrice: 100, entryTimestamp: ASOF - 3_600_000, currentPrice: 103 },
  }),
  expectedOutcome: "MODIFIED",
  expectedActionType: "MOVE_STOP",
  expectedViolationCodes: [],
  reason: "Price has moved +3 (>= the 2-point trigger); breakeven proposes moving the stop to entry + 0.1 = 100.1.",
};

export const RISK_TRAILING: RiskFixture = {
  name: "RISK_TRAILING",
  input: baseInput({
    riskSpecification: {
      sizing: { method: "fixed-lot", lots: 1 },
      trailingStop: {
        activation: { mode: "absolute", value: 2 },
        distance: { mode: "absolute", value: 1 },
      },
    },
    existingPosition: {
      quantity: 1,
      entryPrice: 100,
      entryTimestamp: ASOF - 3_600_000,
      currentPrice: 105,
      currentStopLoss: 100,
    },
  }),
  expectedOutcome: "MODIFIED",
  expectedActionType: "MOVE_STOP",
  expectedViolationCodes: [],
  reason: "Price has moved +5 (>= the 2-point activation); trailing proposes 105 - 1 = 104, which improves on the current stop of 100.",
};

export const RISK_PARTIAL_CLOSE: RiskFixture = {
  name: "RISK_PARTIAL_CLOSE",
  input: baseInput({
    riskSpecification: {
      sizing: { method: "fixed-lot", lots: 1 },
      partialClose: { trigger: { mode: "absolute", value: 3 }, closePercent: 50 },
    },
    existingPosition: { quantity: 1, entryPrice: 100, entryTimestamp: ASOF - 3_600_000, currentPrice: 104 },
  }),
  expectedOutcome: "MODIFIED",
  expectedActionType: "PARTIAL_CLOSE",
  expectedViolationCodes: [],
  reason: "Price has moved +4 (>= the 3-point trigger); partial close proposes closing 50% of the position.",
};

export const RISK_CONFLICT: RiskFixture = {
  name: "RISK_CONFLICT",
  input: baseInput({
    riskSpecification: {
      sizing: { method: "fixed-lot", lots: 1 },
      maxHoldingPeriod: { maxBars: 5 },
      breakeven: { trigger: { mode: "absolute", value: 1 }, lockOffset: { mode: "absolute", value: 0 } },
      trailingStop: { activation: { mode: "absolute", value: 1 }, distance: { mode: "absolute", value: 1 } },
    },
    existingPosition: {
      quantity: 1,
      entryPrice: 100,
      entryTimestamp: ASOF - 20 * 3_600_000,
      currentPrice: 110,
      barsHeld: 8, // exceeds maxBars=5
    },
  }),
  expectedOutcome: "REJECTED",
  expectedActionType: "FORCE_EXIT_REQUIRED",
  expectedViolationCodes: ["MAX_HOLDING_PERIOD"],
  reason:
    "Max holding period, breakeven, and trailing stop would ALL trigger on this position — max holding period wins per the documented safety-first priority (Q0.3.15), even though breakeven/trailing are also individually satisfied.",
};

export const ALL_RISK_FIXTURES: readonly RiskFixture[] = [
  RISK_BASIC_BUY,
  RISK_BASIC_SELL,
  RISK_MAX_POSITION,
  RISK_DAILY_LOSS,
  RISK_SESSION,
  RISK_HOLDING,
  RISK_BREAKEVEN,
  RISK_TRAILING,
  RISK_PARTIAL_CLOSE,
  RISK_CONFLICT,
];
