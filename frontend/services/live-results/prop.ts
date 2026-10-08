// services/live-results/prop.ts
// AT24 Live Results - "Prop Mode": a RULE CHECK of an account against typical prop-firm challenge rules.
// Pure: no DB, no network. Everything is a percent of the INITIAL deposit, so showing it never reveals money.
//
// What it is NOT: not an official result of any prop firm, not a certification. It is the page owner's own rules
// (defaults 10 / 5 / 10 / 4 are common challenge numbers) applied to terminal-reported CLOSED trades.
// Known limits (shown on the page): floating (open) loss is not counted, deposits/withdrawals after the first
// deposit are ignored, days are broker-server days.

import type { ClosedTrade, BalanceOp } from "../edge-analyzer/types";

export interface PropRules {
  /** Profit to reach, percent of the initial deposit. */
  profitTargetPct: number;
  /** Max loss inside one broker day, percent of the initial deposit. */
  dailyLossPct: number;
  /** Max total loss from the initial deposit (static), percent. */
  maxLossPct: number;
  /** Minimum number of broker days with at least one closed trade. */
  minTradingDays: number;
}

export interface PropSettings extends PropRules {
  /** Show the rule check on the PUBLIC page too (the owner always sees it). */
  showPublic: boolean;
}

export const DEFAULT_PROP_RULES: PropRules = { profitTargetPct: 10, dailyLossPct: 5, maxLossPct: 10, minTradingDays: 4 };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Validates a prop-settings object from a request body. Returns the settings, or an error message. */
export function parsePropSettings(raw: unknown): PropSettings | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "propMode must be an object";
  const o = raw as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number, name: string): number | string => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return `${name} must be a number from ${min} to ${max}`;
    return r2(v);
  };
  const target = num(o.profitTargetPct, 0.1, 100, "Profit target");
  if (typeof target === "string") return target;
  const daily = num(o.dailyLossPct, 0.1, 50, "Daily loss limit");
  if (typeof daily === "string") return daily;
  const max = num(o.maxLossPct, 0.1, 100, "Max loss limit");
  if (typeof max === "string") return max;
  if (max < daily) return "The max loss limit cannot be smaller than the daily loss limit";
  const days = o.minTradingDays;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > 60) return "Minimum trading days must be a whole number from 0 to 60";
  if (typeof o.showPublic !== "boolean") return "showPublic must be true or false";
  return { profitTargetPct: target, dailyLossPct: daily, maxLossPct: max, minTradingDays: days, showPublic: o.showPublic };
}

/** Reads a stored JSON value back, tolerating anything (a bad value just means Prop Mode is off). */
export function readStoredProp(v: unknown): PropSettings | null {
  const p = parsePropSettings(v);
  return typeof p === "string" ? null : p;
}

export type PropState = "no_deposit" | "in_progress" | "target_reached" | "rule_broken";

export interface PropCheck {
  rules: PropRules;
  state: PropState;
  /** Closed-trade profit as a percent of the initial deposit (negative = loss). */
  profitPct: number;
  /** Progress to the profit target, 0..100 (never negative). */
  targetProgressPct: number;
  /** Broker days with at least one closed trade. */
  tradingDays: number;
  /** Largest dip inside one broker day (closed-trade sequence), percent of the initial deposit, >= 0. */
  worstDailyLossPct: number;
  worstDailyLossDate: string | null;
  /** Deepest fall below the initial deposit, percent, >= 0. */
  maxLossUsedPct: number;
  /** First day a loss rule was broken, if any. */
  brokenOn: string | null;
  brokenRule: "daily_loss" | "max_loss" | null;
}

export function computePropCheck(trades: readonly ClosedTrade[], balanceOps: readonly BalanceOp[], rules: PropRules): PropCheck {
  const empty = (state: PropState): PropCheck => ({ rules, state, profitPct: 0, targetProgressPct: 0, tradingDays: 0, worstDailyLossPct: 0, worstDailyLossDate: null, maxLossUsedPct: 0, brokenOn: null, brokenRule: null });
  const first = [...balanceOps].sort((a, b) => a.time - b.time)[0];
  if (!first || first.amount <= 0) return empty("no_deposit");
  const initial = first.amount;

  const sorted = [...trades].sort((a, b) => a.closeTime - b.closeTime);
  const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

  let cum = 0;
  let lowest = 0;
  let curDay = "";
  let dayRun = 0;
  let dayLow = 0;
  let worstDaily = 0;
  let worstDailyDate: string | null = null;
  let maxLossBreachOn: string | null = null;
  let dailyBreachOn: string | null = null;
  const days = new Set<string>();

  const closeDay = () => {
    if (curDay === "") return;
    const lossPct = (-dayLow / initial) * 100;
    if (lossPct > worstDaily) {
      worstDaily = lossPct;
      worstDailyDate = curDay;
    }
  };

  for (const t of sorted) {
    const d = dayOf(t.closeTime);
    if (d !== curDay) {
      closeDay();
      curDay = d;
      dayRun = 0;
      dayLow = 0;
    }
    days.add(d);
    cum += t.net;
    dayRun += t.net;
    if (dayRun < dayLow) dayLow = dayRun;
    if (cum < lowest) lowest = cum;
    if (dailyBreachOn === null && (-dayLow / initial) * 100 >= rules.dailyLossPct) dailyBreachOn = d;
    if (maxLossBreachOn === null && (-cum / initial) * 100 >= rules.maxLossPct) maxLossBreachOn = d;
  }
  closeDay();

  const profitPct = (cum / initial) * 100;
  const maxLossUsed = (-lowest / initial) * 100;
  let brokenOn: string | null = null;
  let brokenRule: PropCheck["brokenRule"] = null;
  if (dailyBreachOn !== null && (maxLossBreachOn === null || dailyBreachOn <= maxLossBreachOn)) {
    brokenOn = dailyBreachOn;
    brokenRule = "daily_loss";
  } else if (maxLossBreachOn !== null) {
    brokenOn = maxLossBreachOn;
    brokenRule = "max_loss";
  }
  const state: PropState = brokenOn !== null ? "rule_broken" : profitPct >= rules.profitTargetPct && days.size >= rules.minTradingDays ? "target_reached" : "in_progress";
  return {
    rules,
    state,
    profitPct: r2(profitPct),
    targetProgressPct: r2(Math.max(0, Math.min(100, (profitPct / rules.profitTargetPct) * 100))),
    tradingDays: days.size,
    worstDailyLossPct: r2(worstDaily),
    worstDailyLossDate: worstDailyDate,
    maxLossUsedPct: r2(maxLossUsed),
    brokenOn,
    brokenRule,
  };
}

export const PROP_DISCLAIMER = "A rule check on terminal-reported CLOSED trades against the page owner's own limits. It is not an official result of any prop firm. Floating (open) losses are not counted, deposits and withdrawals after the first deposit are ignored, and days are the broker's server days.";
