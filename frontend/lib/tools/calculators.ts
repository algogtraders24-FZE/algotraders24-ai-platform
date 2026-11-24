// lib/tools/calculators.ts
// Free public trading calculators (no login): pure arithmetic only, no market data, no advice. Used by app/tools/* and checked by
// scripts/validate-tools-calculators.ts. Every function returns null for invalid input instead of guessing.

export interface ToolInstrument {
  id: string;
  label: string;
  /** Size of one pip in price units (0.0001, 0.01 for JPY pairs, 0.1 for gold). */
  pipSize: number;
  /** Units of the base asset in one standard lot (100,000 currency units, 100 oz of gold). */
  contractSize: number;
  /** Currency the pip value is first expressed in. */
  quote: "USD" | "JPY" | "CHF" | "CAD";
}

export const TOOL_INSTRUMENTS: readonly ToolInstrument[] = [
  { id: "EURUSD", label: "EUR/USD", pipSize: 0.0001, contractSize: 100_000, quote: "USD" },
  { id: "GBPUSD", label: "GBP/USD", pipSize: 0.0001, contractSize: 100_000, quote: "USD" },
  { id: "AUDUSD", label: "AUD/USD", pipSize: 0.0001, contractSize: 100_000, quote: "USD" },
  { id: "NZDUSD", label: "NZD/USD", pipSize: 0.0001, contractSize: 100_000, quote: "USD" },
  { id: "USDJPY", label: "USD/JPY", pipSize: 0.01, contractSize: 100_000, quote: "JPY" },
  { id: "USDCHF", label: "USD/CHF", pipSize: 0.0001, contractSize: 100_000, quote: "CHF" },
  { id: "USDCAD", label: "USD/CAD", pipSize: 0.0001, contractSize: 100_000, quote: "CAD" },
  { id: "XAUUSD", label: "Gold (XAU/USD)", pipSize: 0.1, contractSize: 100, quote: "USD" },
];

export function getInstrument(id: string): ToolInstrument | undefined {
  return TOOL_INSTRUMENTS.find((i) => i.id === id);
}

const finite = (n: number) => Number.isFinite(n);

/**
 * Value of one pip for one standard lot, in USD. For pairs quoted in USD it is pipSize x contractSize.
 * For USD-base pairs (USD/JPY, USD/CHF, USD/CAD) the pip value is in the quote currency and is converted with the pair's own price.
 */
export function pipValuePerLotUsd(inst: ToolInstrument, price: number | null): number | null {
  const inQuote = inst.pipSize * inst.contractSize;
  if (inst.quote === "USD") return inQuote;
  if (price === null || !finite(price) || price <= 0) return null;
  return inQuote / price;
}

export interface PositionSizeInput {
  balance: number;
  riskPct: number;
  stopPips: number;
  pipValuePerLot: number;
}
export interface PositionSizeResult {
  riskAmount: number;
  lots: number;
  /** Lots rounded down to the usual 0.01 step (never rounded up, so risk is never above the limit). */
  lotsRounded: number;
  riskAtRounded: number;
}
export function positionSize(i: PositionSizeInput): PositionSizeResult | null {
  const { balance, riskPct, stopPips, pipValuePerLot } = i;
  if (![balance, riskPct, stopPips, pipValuePerLot].every(finite)) return null;
  if (balance <= 0 || riskPct <= 0 || riskPct > 100 || stopPips <= 0 || pipValuePerLot <= 0) return null;
  const riskAmount = balance * (riskPct / 100);
  const lots = riskAmount / (stopPips * pipValuePerLot);
  const lotsRounded = Math.floor(lots * 100 + 1e-9) / 100;
  return { riskAmount, lots, lotsRounded, riskAtRounded: lotsRounded * stopPips * pipValuePerLot };
}

export interface RiskRewardInput { entry: number; stop: number; target: number }
export interface RiskRewardResult {
  direction: "long" | "short";
  risk: number;
  reward: number;
  /** reward divided by risk, i.e. the "R" of the target. */
  rr: number;
  /** The share of trades that must reach the target for the plan to break even before costs: risk / (risk + reward). */
  breakevenWinPct: number;
}
export function riskReward(i: RiskRewardInput): RiskRewardResult | null {
  const { entry, stop, target } = i;
  if (![entry, stop, target].every(finite) || entry <= 0 || stop <= 0 || target <= 0) return null;
  if (stop < entry && target > entry) {
    const risk = entry - stop, reward = target - entry;
    return { direction: "long", risk, reward, rr: reward / risk, breakevenWinPct: (risk / (risk + reward)) * 100 };
  }
  if (stop > entry && target < entry) {
    const risk = stop - entry, reward = entry - target;
    return { direction: "short", risk, reward, rr: reward / risk, breakevenWinPct: (risk / (risk + reward)) * 100 };
  }
  return null; // stop and target are not on opposite sides of the entry
}

/** After losing lossPct of an account, the gain needed to get back to the starting balance. */
export function recoveryGainPct(lossPct: number): number | null {
  if (!finite(lossPct) || lossPct <= 0 || lossPct >= 100) return null;
  return (1 / (1 - lossPct / 100) - 1) * 100;
}

export interface LosingStreakRow { losses: number; balance: number; lossPct: number; gainNeededPct: number }
/** Balance after N losing trades in a row at a fixed percent risk of the current balance. */
export function losingStreak(balance: number, riskPct: number, maxLosses = 10): LosingStreakRow[] | null {
  if (!finite(balance) || !finite(riskPct) || balance <= 0 || riskPct <= 0 || riskPct >= 100) return null;
  const rows: LosingStreakRow[] = [];
  let b = balance;
  for (let n = 1; n <= maxLosses; n++) {
    b = b * (1 - riskPct / 100);
    const lossPct = (1 - b / balance) * 100;
    rows.push({ losses: n, balance: b, lossPct, gainNeededPct: (1 / (1 - lossPct / 100) - 1) * 100 });
  }
  return rows;
}
