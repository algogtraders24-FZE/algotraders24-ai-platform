// services/market-alerts/alerts.ts
// AT24 market alerts - the pure part (no DB, no network). Three things a trader wants to be told about, none of
// which is a trade call: price is close to yesterday's high / low, volatility has turned high, a high-impact event
// is minutes away. A condition is announced once (edge-triggered), reminded only after the cooldown while it lasts,
// and re-armed when it clears - the same state machine the Live Sync alerts use.

import { fmtDist, fmtPrice } from "@/services/smc/expected-range";
import type { Evaluation } from "@/services/live-sync/alerts";

export { nextTransition, type Transition, type Evaluation } from "@/services/live-sync/alerts";

export type MarketAlertKind = "level_near" | "vol_high" | "event_soon";
export const MARKET_ALERT_KINDS: readonly MarketAlertKind[] = ["level_near", "vol_high", "event_soon"];

export interface MarketAlertKindInfo {
  kind: MarketAlertKind;
  label: string;
  unit: string;
  defaultThreshold: number;
  /** Allowed choices for the threshold (the UI offers exactly these); null = no threshold. */
  options: readonly number[] | null;
  defaultCooldownMin: number;
  help: string;
}

export const MARKET_ALERT_INFO: Record<MarketAlertKind, MarketAlertKindInfo> = {
  level_near: {
    kind: "level_near",
    label: "Price near yesterday's high or low",
    unit: "ATR from the level",
    defaultThreshold: 0.5,
    options: [0.25, 0.5, 1],
    defaultCooldownMin: 240,
    help: "Alert when price comes within this many ATRs of yesterday's high or low (a level not yet swept).",
  },
  vol_high: {
    kind: "vol_high",
    label: "Volatility turns high",
    unit: "",
    defaultThreshold: 1.3,
    options: null,
    defaultCooldownMin: 360,
    help: "Alert when the current ATR is more than 1.3x its recent average (the engine's own High regime).",
  },
  event_soon: {
    kind: "event_soon",
    label: "High-impact event coming up",
    unit: "minutes before",
    defaultThreshold: 30,
    options: [15, 30, 60],
    defaultCooldownMin: 90,
    help: "Alert this many minutes before a high-impact release for the instrument's currencies (CPI, rate decisions, payrolls...).",
  },
};

/** What the alerts need to know about one symbol right now. Absent parts mean "no data": the rule is skipped, never guessed. */
export interface MarketAlertContext {
  nowUtc: number;
  smc: {
    price: number;
    atr: number;
    pools: ReadonlyArray<{ kind: string; price: number; status: string }>;
    volatility: "High" | "Normal" | "Low" | "--";
    volatilityRatio: number | null;
  } | null;
  events: ReadonlyArray<{ title: string; currency: string; eventTime: string; impact: string; isHoliday?: boolean; allDay?: boolean }> | null;
}

export const SYMBOL_LABEL: Record<string, string> = {
  XAUUSD: "Gold",
  XAGUSD: "Silver",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  BTCUSD: "Bitcoin",
  ETHUSD: "Ethereum",
};
export const labelFor = (symbol: string): string => SYMBOL_LABEL[symbol] ?? symbol;

/** The unswept (untouched or only tested) PDH / PDL nearest to price, with its distance. */
function nearestDailyLevel(ctx: NonNullable<MarketAlertContext["smc"]>) {
  let best: { kind: "PDH" | "PDL"; price: number; dist: number } | null = null;
  for (const kind of ["PDH", "PDL"] as const) {
    const pools = ctx.pools.filter((p) => p.kind === kind);
    const p = pools[pools.length - 1];
    if (!p || p.status === "swept") continue;
    const dist = Math.abs(p.price - ctx.price);
    if (!best || dist < best.dist) best = { kind, price: p.price, dist };
  }
  return best;
}

export function evaluateMarketRule(rule: { kind: MarketAlertKind; threshold: number; symbol: string }, ctx: MarketAlertContext): Evaluation {
  const none: Evaluation = { breached: false, value: null, detail: "" };
  const name = labelFor(rule.symbol);

  if (rule.kind === "level_near") {
    if (!ctx.smc || !(ctx.smc.atr > 0)) return none;
    const lvl = nearestDailyLevel(ctx.smc);
    if (!lvl) return { breached: false, value: null, detail: "" }; // both levels already swept: nothing to be near
    const atrs = lvl.dist / ctx.smc.atr;
    const side = lvl.price >= ctx.smc.price ? "below" : "above";
    return {
      breached: atrs <= rule.threshold,
      value: Math.round(atrs * 100) / 100,
      detail: `${name} is ${atrs.toFixed(2)} ATR (${fmtDist(lvl.dist, ctx.smc.price)}) ${side} yesterday's ${lvl.kind === "PDH" ? "high" : "low"} ${fmtPrice(lvl.price)}, price ${fmtPrice(ctx.smc.price)}.`,
    };
  }

  if (rule.kind === "vol_high") {
    if (!ctx.smc || ctx.smc.volatilityRatio === null || ctx.smc.volatility === "--") return none;
    const ratio = ctx.smc.volatilityRatio;
    return {
      breached: ratio > rule.threshold,
      value: Math.round(ratio * 100) / 100,
      detail: `${name} volatility is ${ratio.toFixed(2)}x its recent average (ATR ${fmtDist(ctx.smc.atr, ctx.smc.price)}). Moves are running larger than usual.`,
    };
  }

  // event_soon
  if (!ctx.events) return none;
  const soon = ctx.events
    .filter((e) => e.impact === "high" && !e.isHoliday && !e.allDay)
    .map((e) => ({ e, mins: (new Date(e.eventTime).getTime() - ctx.nowUtc) / 60000 }))
    .filter((x) => Number.isFinite(x.mins) && x.mins >= 0)
    .sort((a, b) => a.mins - b.mins);
  const next = soon[0];
  if (!next) return { breached: false, value: 9999, detail: "" }; // no upcoming event at all: a real "no" (resolves a firing rule)
  const within = soon.filter((x) => x.mins <= rule.threshold && Math.abs(x.mins - next.mins) < 1);
  const mins = Math.round(next.mins);
  return {
    breached: next.mins <= rule.threshold,
    value: mins,
    detail: within.length > 0
      ? `High-impact ${within.map((x) => `${x.e.currency} ${x.e.title}`).join(", ")} in ${mins} min. ${name} can move sharply around the release.`
      : "",
  };
}

export function marketAlertSeverity(kind: MarketAlertKind): "info" | "warning" {
  return kind === "vol_high" ? "warning" : "info";
}

export function marketAlertText(kind: MarketAlertKind, symbol: string, ev: Evaluation, reminder: boolean): { title: string; body: string } {
  const name = labelFor(symbol);
  const title =
    kind === "level_near" ? `${name}: near yesterday's high or low` : kind === "vol_high" ? `${name}: volatility is high` : `${name}: high-impact event in ${ev.value} min`;
  return {
    title: `${reminder ? "Still: " : ""}${title}`,
    body: `${ev.detail} An information alert only - not a trade call.`,
  };
}

export interface MarketRuleInput {
  symbol: string;
  kind: MarketAlertKind;
  enabled: boolean;
  threshold: number;
}
export type MarketRuleValidation = { ok: true; value: MarketRuleInput } | { ok: false; message: string };

export function validateMarketRuleInput(body: unknown, allowedSymbols: readonly string[]): MarketRuleValidation {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.symbol !== "string" || !allowedSymbols.includes(b.symbol)) return { ok: false, message: `symbol must be one of: ${allowedSymbols.join(", ")}` };
  if (typeof b.kind !== "string" || !MARKET_ALERT_KINDS.includes(b.kind as MarketAlertKind)) return { ok: false, message: `kind must be one of: ${MARKET_ALERT_KINDS.join(", ")}` };
  const kind = b.kind as MarketAlertKind;
  const info = MARKET_ALERT_INFO[kind];
  if (typeof b.enabled !== "boolean") return { ok: false, message: "enabled must be true or false" };
  let threshold = info.defaultThreshold;
  if (info.options) {
    if (b.threshold !== undefined) {
      if (typeof b.threshold !== "number" || !info.options.includes(b.threshold)) return { ok: false, message: `threshold must be one of: ${info.options.join(", ")}` };
      threshold = b.threshold;
    }
  }
  return { ok: true, value: { symbol: b.symbol, kind, enabled: b.enabled, threshold } };
}
