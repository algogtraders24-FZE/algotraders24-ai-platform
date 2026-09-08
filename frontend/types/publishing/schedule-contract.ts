// types/publishing/schedule-contract.ts
// AT24 Publishing Contract - scheduling (Sprint P2.4).
//
// P2.4 adds a SCHEDULED publish path on top of P2.3's immediate one. The
// design is deliberately minimal, driven by one hard constraint:
//
//   The project is on the Vercel HOBBY plan -> at most ONE cron run per path
//   per day (a sub-daily entry silently blocks every deployment; this already
//   caused a ~1-day outage). So the publishing dispatcher runs ONCE A DAY.
//
// Given a once-daily dispatcher, a free "publish at 14:37" clock would be a
// lie. Instead a scheduled job targets one of a small set of PRESET DAILY
// SLOTS. `PublishingJob.scheduledFor` is then the next UTC instant matching
// that slot; the dispatcher (which already skips a future `scheduledFor`)
// publishes it on its first run at or after that instant.
//
// TIMEZONE (LOCKED for P2.4): the backend is UTC-only. Slots are UTC times of
// day. `scheduledFor` is a UTC instant. There is NO timezone conversion
// anywhere in the backend. A future UI will let a user pick a local time and
// convert it to the nearest approved UTC slot before calling the API - that
// conversion is a UI concern, explicitly out of P2.4 scope.
//
// Pure module: shapes + a closed vocabulary + one deterministic date
// function. No I/O.

import { type ContractViolation, type ContractValidationResult, contractResult } from "./common";

/**
 * The approved daily publish slots, as `HH:MM` UTC times of day. Kept small
 * and fixed. Adding a slot is one member here (and a product decision) - it
 * needs no schema change and no contract-version bump.
 *
 * With a single daily Hobby cron the *effective* resolution is "the next
 * daily dispatch", so two slots (start-of-day / midday UTC) is enough to
 * express "publish in the earliest batch" vs "hold for the next one". The
 * model is already correct for when more cron runs are added (Pro plan).
 */
export type PublishingSlot = "00:00" | "12:00";

export const PUBLISHING_SLOTS: readonly PublishingSlot[] = ["00:00", "12:00"] as const;

export function isPublishingSlot(value: unknown): value is PublishingSlot {
  return typeof value === "string" && (PUBLISHING_SLOTS as readonly string[]).includes(value);
}

/** Parsed `{ hour, minute }` for a slot. */
export function slotTimeUtc(slot: PublishingSlot): { hour: number; minute: number } {
  const [h, m] = slot.split(":");
  return { hour: Number(h), minute: Number(m) };
}

/**
 * The schedule requested when a job is created.
 *  - `immediate` : publish in the very next dispatcher run (no `scheduledFor`).
 *  - `slot`      : publish at/after the next occurrence of `slot` (UTC).
 */
export type PublishSchedule =
  | { kind: "immediate" }
  | { kind: "slot"; slot: PublishingSlot };

export const IMMEDIATE_SCHEDULE: PublishSchedule = { kind: "immediate" };

export function isPublishSchedule(value: unknown): value is PublishSchedule {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  if (s.kind === "immediate") return true;
  if (s.kind === "slot") return isPublishingSlot(s.slot);
  return false;
}

export function validatePublishSchedule(value: unknown): ContractValidationResult {
  if (isPublishSchedule(value)) return contractResult([]);
  const v: ContractViolation[] = [];
  if (!value || typeof value !== "object") {
    v.push({ path: "", message: "schedule must be { kind: 'immediate' } or { kind: 'slot', slot }." });
    return contractResult(v);
  }
  const s = value as Record<string, unknown>;
  if (s.kind !== "immediate" && s.kind !== "slot") {
    v.push({ path: "kind", message: "kind must be 'immediate' or 'slot'." });
  } else if (s.kind === "slot" && !isPublishingSlot(s.slot)) {
    v.push({ path: "slot", message: `slot must be one of: ${PUBLISHING_SLOTS.join(", ")} (UTC).` });
  }
  return contractResult(v);
}

/**
 * DETERMINISTIC. The next UTC instant matching `slot`, strictly AFTER `from`.
 *
 *   - today's slot instant is used only if it is strictly in the future
 *     relative to `from`;
 *   - otherwise (it is now, or already past) the slot rolls to TOMORROW.
 *
 * "Strictly after" makes the boundary unambiguous: scheduling for the 12:00
 * slot at exactly 12:00:00.000Z targets tomorrow, never a same-instant race.
 * Same input `from` always yields the same result, on any machine, forever.
 */
export function nextSlotOccurrence(slot: PublishingSlot, from: Date): Date {
  const { hour, minute } = slotTimeUtc(slot);
  const todaySlot = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute, 0, 0),
  );
  if (todaySlot.getTime() > from.getTime()) return todaySlot;
  return new Date(todaySlot.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Resolve a `PublishSchedule` to the `scheduledFor` value a PublishingJob
 * should carry: `null` for immediate, else the next slot occurrence as an ISO
 * string. `now` is injected for testability / determinism.
 */
export function resolveScheduledFor(schedule: PublishSchedule, now: Date): string | null {
  if (schedule.kind === "immediate") return null;
  return nextSlotOccurrence(schedule.slot, now).toISOString();
}
