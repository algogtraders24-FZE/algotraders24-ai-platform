// services/swing-lab/planner.ts
// Pure maths for the swing position planner (also used by the page; no network, no "server-only").
//   risk amount = account * risk% / 100
//   units = risk amount / |entry - stop|           (stop distance per unit of the asset)
//   notional = units * entry;  leverage needed = notional / account
//   R multiple of a target = |target - entry| / |entry - stop|, valid only when the target is on the profit side
//   stop distance in daily ATR = |entry - stop| / ATR (ATR = atrPct / 100 * entry), flagged tight below 0.5 and wide above 3
//   break-even win rate for the target R = 1 / (1 + R)
export type PlanSide = "long" | "short";

export interface PlanInput {
  account: number;
  riskPct: number;
  entry: number;
  stop: number;
  target?: number | null;
  side: PlanSide;
  /** Daily ATR as percent of price, optional. */
  atrPct?: number | null;
}

export interface PlanResult {
  ok: boolean;
  errors: string[];
  riskAmount: number;
  units: number;
  notional: number;
  leverage: number;
  stopDistancePct: number;
  stopAtr: number | null;
  stopNote: "tight" | "wide" | "ok" | null;
  rMultiple: number | null;
  rewardAmount: number | null;
  breakEvenWinPct: number | null;
}

export function planSwing(i: PlanInput): PlanResult {
  const errors: string[] = [];
  if (!(i.account > 0)) errors.push("Account size must be above 0.");
  if (!(i.riskPct > 0) || i.riskPct > 5) errors.push("Risk per trade must be above 0 and at most 5 percent.");
  if (!(i.entry > 0)) errors.push("Entry price must be above 0.");
  if (!(i.stop > 0)) errors.push("Stop price must be above 0.");
  const stopOnLossSide = i.side === "long" ? i.stop < i.entry : i.stop > i.entry;
  if (i.entry > 0 && i.stop > 0 && !stopOnLossSide) errors.push(i.side === "long" ? "For a long trade the stop must be below the entry." : "For a short trade the stop must be above the entry.");
  const empty: PlanResult = { ok: false, errors, riskAmount: 0, units: 0, notional: 0, leverage: 0, stopDistancePct: 0, stopAtr: null, stopNote: null, rMultiple: null, rewardAmount: null, breakEvenWinPct: null };
  if (errors.length > 0) return empty;
  const riskAmount = (i.account * i.riskPct) / 100;
  const dist = Math.abs(i.entry - i.stop);
  const units = riskAmount / dist;
  const notional = units * i.entry;
  let stopAtr: number | null = null;
  let stopNote: PlanResult["stopNote"] = null;
  if (i.atrPct && i.atrPct > 0) {
    stopAtr = dist / ((i.atrPct / 100) * i.entry);
    stopNote = stopAtr < 0.5 ? "tight" : stopAtr > 3 ? "wide" : "ok";
  }
  let rMultiple: number | null = null;
  let rewardAmount: number | null = null;
  let breakEvenWinPct: number | null = null;
  if (i.target && i.target > 0) {
    const targetOnProfitSide = i.side === "long" ? i.target > i.entry : i.target < i.entry;
    if (!targetOnProfitSide) errors.push(i.side === "long" ? "For a long trade the target must be above the entry." : "For a short trade the target must be below the entry.");
    else {
      rMultiple = Math.abs(i.target - i.entry) / dist;
      rewardAmount = rMultiple * riskAmount;
      breakEvenWinPct = 100 / (1 + rMultiple);
    }
  }
  return { ok: errors.length === 0, errors, riskAmount, units, notional, leverage: notional / i.account, stopDistancePct: (100 * dist) / i.entry, stopAtr, stopNote, rMultiple, rewardAmount, breakEvenWinPct };
}
