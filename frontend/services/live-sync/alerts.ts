// services/live-sync/alerts.ts
// AT24 Live Sync alerts - the pure part (no DB, no network). Alerts only INFORM: the EA is read-only and
// nothing here closes or changes a trade. One rule per kind per account; a breach is announced once, then
// reminded after the cooldown while it lasts; it resets when the condition clears.

import type { WirePosition } from "./contract";

export type AlertKind = "margin_level" | "daily_loss" | "drawdown" | "ea_offline" | "no_stop_loss";

export const ALERT_KINDS: readonly AlertKind[] = ["margin_level", "daily_loss", "drawdown", "ea_offline", "no_stop_loss"];

export interface KindInfo {
  kind: AlertKind;
  label: string;
  unit: string;
  /** Suggested starting threshold. */
  defaultThreshold: number;
  min: number;
  max: number;
  help: string;
}

export const KIND_INFO: Record<AlertKind, KindInfo> = {
  margin_level: { kind: "margin_level", label: "Margin level is low", unit: "%", defaultThreshold: 200, min: 50, max: 5000, help: "Alert when the margin level falls below this percent (a stop-out is near when it gets very low)." },
  daily_loss: { kind: "daily_loss", label: "Daily loss limit", unit: "% of the day's starting balance", defaultThreshold: 5, min: 0.5, max: 90, help: "Alert when equity is this much below the balance at the start of the (broker) day." },
  drawdown: { kind: "drawdown", label: "Drawdown from the peak", unit: "% below the 30-day equity peak", defaultThreshold: 20, min: 1, max: 95, help: "Alert when equity falls this far below its highest level of the last 30 days." },
  ea_offline: { kind: "ea_offline", label: "Live Sync stopped reporting", unit: "minutes without data", defaultThreshold: 10, min: 3, max: 1440, help: "Alert when no data has arrived for this long (terminal or VPS off, EA removed, no internet)." },
  no_stop_loss: { kind: "no_stop_loss", label: "Position without a stop loss", unit: "minutes after opening", defaultThreshold: 5, min: 1, max: 1440, help: "Alert when a position has been open this long with no stop loss set." },
};

export interface AlertRuleState {
  kind: AlertKind;
  threshold: number;
  enabled: boolean;
  cooldownMin: number;
  state: "ok" | "firing";
  lastFiredAt: number | null;
}

export interface AlertContext {
  nowUtc: number;
  /** Seconds the broker clock is ahead of UTC (used for position open times). */
  serverUtcOffsetSec: number;
  /** Newest data received for the account (UTC ms). */
  lastSyncAt: number;
  snapshot: { balance: number; equity: number; margin: number; positions: readonly WirePosition[] } | null;
  /** Balance at the start of the current broker day (first snapshot of the day). */
  dayStartBalance: number | null;
  /** Highest equity in the last 30 days. */
  peakEquity: number | null;
}

export interface Evaluation {
  breached: boolean;
  /** The measured number (null when there is no data to measure). */
  value: number | null;
  detail: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function evaluateRule(rule: Pick<AlertRuleState, "kind" | "threshold">, ctx: AlertContext): Evaluation {
  const s = ctx.snapshot;
  switch (rule.kind) {
    case "margin_level": {
      if (!s || !(s.margin > 0)) return { breached: false, value: null, detail: "No margin in use." };
      const level = r1((s.equity / s.margin) * 100);
      return { breached: level < rule.threshold, value: level, detail: `Margin level is ${level}% (alert below ${rule.threshold}%).` };
    }
    case "daily_loss": {
      if (!s || ctx.dayStartBalance === null || !(ctx.dayStartBalance > 0)) return { breached: false, value: null, detail: "No day-start balance yet." };
      const loss = r2(((ctx.dayStartBalance - s.equity) / ctx.dayStartBalance) * 100);
      return { breached: loss >= rule.threshold, value: loss, detail: `Equity is ${loss}% below today's starting balance (limit ${rule.threshold}%).` };
    }
    case "drawdown": {
      if (!s || ctx.peakEquity === null || !(ctx.peakEquity > 0)) return { breached: false, value: null, detail: "No equity history yet." };
      const dd = r2(((ctx.peakEquity - s.equity) / ctx.peakEquity) * 100);
      return { breached: dd >= rule.threshold, value: dd, detail: `Equity is ${dd}% below its 30-day peak (limit ${rule.threshold}%).` };
    }
    case "ea_offline": {
      const minutes = Math.floor((ctx.nowUtc - ctx.lastSyncAt) / 60000);
      return { breached: minutes >= rule.threshold, value: Math.max(0, minutes), detail: `No data for ${Math.max(0, minutes)} minutes (limit ${rule.threshold}).` };
    }
    case "no_stop_loss": {
      if (!s) return { breached: false, value: null, detail: "No open-position data." };
      const offMs = ctx.serverUtcOffsetSec * 1000;
      const bare = s.positions.filter((p) => !(p.sl > 0) && ctx.nowUtc - (p.timeMsc - offMs) >= rule.threshold * 60000);
      return { breached: bare.length > 0, value: bare.length, detail: `${bare.length} position${bare.length === 1 ? "" : "s"} open for ${rule.threshold}+ minutes without a stop loss.` };
    }
  }
}

export type Transition = { action: "fire"; reminder: boolean } | { action: "resolve" } | { action: "none" };

/** The edge-triggered state machine. No data (value null) never changes state. */
export function nextTransition(rule: Pick<AlertRuleState, "state" | "lastFiredAt" | "cooldownMin" | "enabled">, ev: Evaluation, nowUtc: number): Transition {
  if (!rule.enabled) return rule.state === "firing" ? { action: "resolve" } : { action: "none" };
  if (ev.value === null) return { action: "none" };
  const cooled = rule.lastFiredAt === null || nowUtc - rule.lastFiredAt >= rule.cooldownMin * 60000;
  if (ev.breached) {
    if (rule.state === "ok") return cooled ? { action: "fire", reminder: false } : { action: "none" };
    return cooled ? { action: "fire", reminder: true } : { action: "none" };
  }
  return rule.state === "firing" ? { action: "resolve" } : { action: "none" };
}

export function alertSeverity(kind: AlertKind, value: number | null): "warning" | "critical" {
  if (kind === "margin_level" && value !== null && value < 120) return "critical";
  if (kind === "daily_loss" || kind === "drawdown") return "warning";
  if (kind === "ea_offline") return "warning";
  return "warning";
}

export function alertText(kind: AlertKind, ev: Evaluation, accountLabel: string, reminder: boolean): { title: string; body: string } {
  const info = KIND_INFO[kind];
  return {
    title: `${reminder ? "Still: " : ""}${info.label} - ${accountLabel}`,
    body: `${ev.detail} This is an information alert only; AT24 does not trade or close positions for you.`,
  };
}

export interface RuleInput {
  kind: AlertKind;
  threshold: number;
  enabled: boolean;
  notifyEmail: boolean;
  notifyBell: boolean;
  cooldownMin: number;
}

export type RuleValidation = { ok: true; value: RuleInput } | { ok: false; message: string };

export function validateRuleInput(body: unknown): RuleValidation {
  if (typeof body !== "object" || body === null) return { ok: false, message: "Invalid request" };
  const b = body as Record<string, unknown>;
  if (typeof b.kind !== "string" || !ALERT_KINDS.includes(b.kind as AlertKind)) return { ok: false, message: "Unknown alert type" };
  const kind = b.kind as AlertKind;
  const info = KIND_INFO[kind];
  const threshold = Number(b.threshold);
  if (!Number.isFinite(threshold) || threshold < info.min || threshold > info.max) return { ok: false, message: `Threshold must be between ${info.min} and ${info.max}.` };
  if (typeof b.enabled !== "boolean" || typeof b.notifyEmail !== "boolean" || typeof b.notifyBell !== "boolean") return { ok: false, message: "enabled, notifyEmail and notifyBell must be true or false" };
  const cooldown = Number(b.cooldownMin);
  if (!Number.isInteger(cooldown) || cooldown < 10 || cooldown > 1440) return { ok: false, message: "Cooldown must be between 10 and 1440 minutes." };
  return { ok: true, value: { kind, threshold, enabled: b.enabled, notifyEmail: b.notifyEmail, notifyBell: b.notifyBell, cooldownMin: cooldown } };
}
