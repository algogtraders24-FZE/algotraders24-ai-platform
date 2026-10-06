// services/mcp/risk-calculator.ts
// AT24 MCP v1 - pure, deterministic position-size math. No I/O, no market
// data, no LLM. It computes the user's own planning numbers from the user's
// own inputs; it is not advice and never places or implies an order.

export interface RiskCalcInput {
  accountBalance: number;
  /** Percent of balance risked on the trade, 0 < x <= 100. */
  riskPercent: number;
  entry: number;
  stopLoss: number;
  takeProfit?: number;
  /** Account-currency value of a 1.0 price move on 1 lot (e.g. 100 for XAUUSD
   *  where 1 lot = 100 oz, 100000 for EURUSD). Supplied by the caller. */
  valuePerPricePerLot: number;
  /** Broker volume step, default 0.01. */
  lotStep?: number;
}

export interface RiskCalcResult {
  direction: "long" | "short";
  riskAmount: number;
  stopDistance: number;
  /** Raw lots before rounding. */
  rawLots: number;
  /** Lots rounded DOWN to lotStep (never rounds risk up). */
  lots: number;
  /** Actual money at risk at the rounded lot size. */
  actualRiskAmount: number;
  actualRiskPercent: number;
  rewardToRisk?: number;
  potentialReward?: number;
}

export type RiskCalcOutcome = { ok: true; value: RiskCalcResult } | { ok: false; message: string };

const MAX_NUMBER = 1e12;

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n < MAX_NUMBER;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function calculateRisk(input: RiskCalcInput): RiskCalcOutcome {
  const { accountBalance, riskPercent, entry, stopLoss, takeProfit, valuePerPricePerLot } = input;
  const lotStep = input.lotStep ?? 0.01;
  if (!isPositive(accountBalance)) return { ok: false, message: "accountBalance must be a positive number." };
  if (!isPositive(riskPercent) || riskPercent > 100) return { ok: false, message: "riskPercent must be > 0 and <= 100." };
  if (!isPositive(entry)) return { ok: false, message: "entry must be a positive number." };
  if (!isPositive(stopLoss)) return { ok: false, message: "stopLoss must be a positive number." };
  if (!isPositive(valuePerPricePerLot)) return { ok: false, message: "valuePerPricePerLot must be a positive number." };
  if (!isPositive(lotStep) || lotStep > 100) return { ok: false, message: "lotStep must be a positive number <= 100." };
  if (stopLoss === entry) return { ok: false, message: "stopLoss must differ from entry." };
  if (takeProfit !== undefined) {
    if (!isPositive(takeProfit)) return { ok: false, message: "takeProfit must be a positive number." };
    const longSide = stopLoss < entry;
    if (longSide ? takeProfit <= entry : takeProfit >= entry) {
      return { ok: false, message: "takeProfit must be on the profit side of entry (opposite the stop)." };
    }
  }

  const direction: "long" | "short" = stopLoss < entry ? "long" : "short";
  const stopDistance = Math.abs(entry - stopLoss);
  const riskAmount = accountBalance * (riskPercent / 100);
  const rawLots = riskAmount / (stopDistance * valuePerPricePerLot);
  // Floor to the step with a tiny epsilon so 0.30000000000000004-style float
  // noise cannot drop a whole step.
  const lots = round(Math.floor(rawLots / lotStep + 1e-9) * lotStep, 8);
  const actualRiskAmount = lots * stopDistance * valuePerPricePerLot;

  const result: RiskCalcResult = {
    direction,
    riskAmount: round(riskAmount, 2),
    stopDistance: round(stopDistance, 8),
    rawLots: round(rawLots, 6),
    lots,
    actualRiskAmount: round(actualRiskAmount, 2),
    actualRiskPercent: round((actualRiskAmount / accountBalance) * 100, 4),
  };
  if (takeProfit !== undefined) {
    const rewardDistance = Math.abs(takeProfit - entry);
    result.rewardToRisk = round(rewardDistance / stopDistance, 3);
    result.potentialReward = round(lots * rewardDistance * valuePerPricePerLot, 2);
  }
  return { ok: true, value: result };
}
