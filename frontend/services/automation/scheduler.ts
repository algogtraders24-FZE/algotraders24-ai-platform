// services/automation/scheduler.ts
// AT24 Automation (MVP) - the preset-slot scheduler.
//
// LOCKED (AUTOMATION_DECISION_LOCK.md D2/D3): fixed daily IST slots. This
// module is PURE (no DB) - it computes, from a validated definition + a
// clock, when the automation should next run and whether it is due for a
// given slot pass. The dispatcher does the DB reads/writes + dedup +
// concurrency guards.
//
// Post-Beta upgrade seam: replace `isDueForSlot` / `computeNextRunAt`'s
// slot lookup with a per-automation timeOfDay + timezone comparison. The
// AutomationRun model, idempotency key and API contract do not change.

import type { AutomationWorkflowDefinition, AutomationWeekday } from "@/types/automation";
import {
  getSlot,
  slotInstantForIstDay,
  istWeekday,
  type AutomationSlot,
} from "@/config/automation-slots";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The slot instant for the IST day that `anchor` falls in. */
export function slotInstantOn(slot: AutomationSlot, anchor: Date): Date {
  return slotInstantForIstDay(slot, anchor);
}

/**
 * The next time this automation should run, strictly after `from`. `null`
 * for manual triggers and for a `once` trigger that has already fired
 * (caller passes `alreadyRan`).
 */
export function computeNextRunAt(
  def: AutomationWorkflowDefinition,
  from: Date,
  opts: { onceAlreadyRan?: boolean } = {},
): Date | null {
  const t = def.trigger;
  if (t.type === "manual") return null;
  const slot = t.slot ? getSlot(t.slot) : undefined;
  if (!slot) return null;

  if (t.type === "once") {
    if (opts.onceAlreadyRan) return null;
    const runAt = t.runAt ? new Date(t.runAt) : null;
    if (!runAt || Number.isNaN(runAt.getTime())) return null;
    // First slot instant on/after the runAt calendar day.
    for (let i = 0; i < 400; i++) {
      const day = new Date(runAt.getTime() + i * DAY_MS);
      const inst = slotInstantOn(slot, day);
      if (inst.getTime() >= runAt.getTime() && inst.getTime() > from.getTime()) return inst;
      // if the slot instant is before `from` (already passed) keep scanning
      if (inst.getTime() > from.getTime()) return inst;
    }
    return null;
  }

  // daily / weekly: scan forward day by day
  const days: Set<AutomationWeekday> | null =
    t.type === "weekly" ? new Set((t.daysOfWeek ?? []) as AutomationWeekday[]) : null;

  for (let i = 0; i < 14; i++) {
    const anchor = new Date(from.getTime() + i * DAY_MS);
    const inst = slotInstantOn(slot, anchor);
    if (inst.getTime() <= from.getTime()) continue;
    if (days && !days.has(istWeekday(inst))) continue;
    return inst;
  }
  return null;
}

export interface DueCheckInput {
  def: AutomationWorkflowDefinition;
  /** the slot pass currently firing */
  slot: AutomationSlot;
  /** wall clock at dispatch */
  now: Date;
  /** whether this automation already has ANY run (for `once`) */
  hasAnyRun: boolean;
}

export interface DueCheckResult {
  due: boolean;
  /** the exact slot instant this pass fills - the AutomationRun.scheduledFor
   *  and the (automationId, scheduledFor) idempotency key */
  slotInstant: Date;
  reason?: string;
}

/**
 * Is this automation due for the slot pass firing at `now`? The slot instant
 * is computed for the IST day of `now` (the cron fires at ~the slot instant,
 * allowing a few minutes of platform jitter either way).
 */
export function isDueForSlot(input: DueCheckInput): DueCheckResult {
  const { def, slot, now, hasAnyRun } = input;
  const slotInstant = slotInstantOn(slot, now);
  const t = def.trigger;

  if (t.type === "manual") return { due: false, slotInstant, reason: "manual trigger" };
  if (t.slot !== slot.id) return { due: false, slotInstant, reason: "different slot" };

  if (t.type === "daily") return { due: true, slotInstant };

  if (t.type === "weekly") {
    const days = new Set((t.daysOfWeek ?? []) as AutomationWeekday[]);
    const wd = istWeekday(slotInstant);
    return days.has(wd)
      ? { due: true, slotInstant }
      : { due: false, slotInstant, reason: `not scheduled on ${wd}` };
  }

  // once
  if (hasAnyRun) return { due: false, slotInstant, reason: "one-time automation already ran" };
  const runAt = t.runAt ? new Date(t.runAt) : null;
  if (!runAt || Number.isNaN(runAt.getTime())) return { due: false, slotInstant, reason: "invalid runAt" };
  return slotInstant.getTime() >= runAt.getTime()
    ? { due: true, slotInstant }
    : { due: false, slotInstant, reason: "runAt not reached" };
}
