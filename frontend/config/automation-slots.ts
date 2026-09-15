// config/automation-slots.ts
// AT24 Automation (MVP) - the preset schedule-slot registry.
//
// LOCKED: AUTOMATION_DECISION_LOCK.md D2/D3 (owner 2026-09-10).
//   - Beta scheduling uses a small fixed set of daily Vercel Cron slots.
//   - All Beta daily/weekly/once automations run on IST (Asia/Kolkata); IST
//     has no DST so a fixed UTC cron honours a fixed IST wall-clock exactly.
//   - This module is the SINGLE source of truth consumed by: the guided
//     builder, the Scheduler (dueForSlot), the cron dispatch route handlers,
//     the vercel.json sanity check, and the proxy.ts CRON_SECRET exemption
//     list.
//
// To add a slot post-Beta: add an entry here, add the matching daily cron to
// frontend/vercel.json (schedule MUST be `<min> <hour> * * *` - never `*/n`,
// which silently blocks all main deploys on the Hobby plan), add the dispatch
// path to CRON_SECRET_EXEMPT_PATHS in frontend/proxy.ts, and add the route
// file. The `assertSlotWiring()` check in
// scripts/validate-automation-dispatch.ts fails if any of those drift.

/** The frozen Beta reference timezone for all preset slots. */
export const AUTOMATION_SCHEDULE_TIMEZONE = "Asia/Kolkata" as const;

/** IST is UTC+05:30, fixed (no DST). Used to convert an IST wall-clock slot
 *  to the UTC cron fields and to compute slot instants. */
export const IST_OFFSET_MINUTES = 5 * 60 + 30;

export interface AutomationSlot {
  /** Stable id stored on AutomationDefinitionVersion.slot. */
  id: string;
  /** Human label shown in the builder, always IST-qualified. */
  label: string;
  /** IST wall-clock hour (0-23). */
  istHour: number;
  /** IST wall-clock minute (0-59). */
  istMinute: number;
  /** The `<min> <hour> * * *` UTC cron expression for vercel.json. */
  cron: string;
  /** The exact dispatch route pathname (also the proxy.ts exemption key). */
  dispatchPath: string;
}

function toUtcCron(istHour: number, istMinute: number): string {
  // minutes past IST midnight -> minutes past UTC midnight
  const istTotal = istHour * 60 + istMinute;
  let utcTotal = (istTotal - IST_OFFSET_MINUTES) % (24 * 60);
  if (utcTotal < 0) utcTotal += 24 * 60;
  const h = Math.floor(utcTotal / 60);
  const m = utcTotal % 60;
  return `${m} ${h} * * *`;
}

/** Beta slot set - LOCKED to "B" (2 slots): morning + evening IST. */
export const AUTOMATION_SLOTS: readonly AutomationSlot[] = [
  {
    id: "morning_ist",
    label: "Morning · 08:00 IST",
    istHour: 8,
    istMinute: 0,
    cron: toUtcCron(8, 0), // "30 2 * * *"
    dispatchPath: "/api/private/automations/cron/dispatch/morning-ist",
  },
  {
    id: "evening_ist",
    label: "Evening · 18:30 IST",
    istHour: 18,
    istMinute: 30,
    cron: toUtcCron(18, 30), // "0 13 * * *"
    dispatchPath: "/api/private/automations/cron/dispatch/evening-ist",
  },
] as const;

export type AutomationSlotId = (typeof AUTOMATION_SLOTS)[number]["id"];

const BY_ID = new Map(AUTOMATION_SLOTS.map((s) => [s.id, s]));
const BY_PATH = new Map(AUTOMATION_SLOTS.map((s) => [s.dispatchPath, s]));

export function isAutomationSlotId(value: unknown): value is AutomationSlotId {
  return typeof value === "string" && BY_ID.has(value);
}

export function getSlot(id: string): AutomationSlot | undefined {
  return BY_ID.get(id);
}

export function getSlotByDispatchPath(path: string): AutomationSlot | undefined {
  return BY_PATH.get(path);
}

/** Every dispatch path - for proxy.ts CRON_SECRET_EXEMPT_PATHS and tests. */
export function allDispatchPaths(): string[] {
  return AUTOMATION_SLOTS.map((s) => s.dispatchPath);
}

/**
 * The exact UTC instant a slot "fires" on a given calendar day, expressed as
 * the IST wall-clock time on that IST day. `istDayAnchor` is any Date; the
 * IST calendar day it falls in is used.
 */
export function slotInstantForIstDay(slot: AutomationSlot, istDayAnchor: Date): Date {
  // Shift into "IST clock space" to read the IST calendar day safely.
  const istClock = new Date(istDayAnchor.getTime() + IST_OFFSET_MINUTES * 60_000);
  const y = istClock.getUTCFullYear();
  const mo = istClock.getUTCMonth();
  const d = istClock.getUTCDate();
  // Build the IST wall-clock instant, then subtract the offset to get UTC.
  const asIfUtc = Date.UTC(y, mo, d, slot.istHour, slot.istMinute, 0, 0);
  return new Date(asIfUtc - IST_OFFSET_MINUTES * 60_000);
}

/** The IST weekday code for a Date (MON..SUN), per the IST calendar. */
export function istWeekday(at: Date): "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN" {
  const istClock = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  // getUTCDay: 0=Sun..6=Sat
  const map = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
  return map[istClock.getUTCDay()];
}
