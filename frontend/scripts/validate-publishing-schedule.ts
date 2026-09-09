// scripts/validate-publishing-schedule.ts
// AT24 Publishing Engine (P2.4) - scheduling contract + the single daily
// cron declaration. Pure / in-memory (plus one read of vercel.json and the
// dispatch route source). No DB, no network. House test pattern.
//   npm run validate:publishing-schedule

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  PUBLISHING_SLOTS,
  isPublishingSlot,
  slotTimeUtc,
  isPublishSchedule,
  validatePublishSchedule,
  nextSlotOccurrence,
  resolveScheduledFor,
  IMMEDIATE_SCHEDULE,
  type PublishingSlot,
} from "../types/publishing";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok   - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

console.log("\nPublishing scheduling contract + daily cron - validation\n");

// ---- slot vocabulary -------------------------------------------------

test("slots are a small fixed set of HH:MM UTC times", () => {
  assert.deepEqual([...PUBLISHING_SLOTS], ["00:00", "12:00"]);
  for (const s of PUBLISHING_SLOTS) assert.match(s, /^\d{2}:\d{2}$/);
});

test("isPublishingSlot guard", () => {
  assert.ok(isPublishingSlot("00:00"));
  assert.ok(isPublishingSlot("12:00"));
  assert.equal(isPublishingSlot("06:30"), false);
  assert.equal(isPublishingSlot("0:00"), false);
  assert.equal(isPublishingSlot(1200), false);
  assert.equal(isPublishingSlot(null), false);
});

test("slotTimeUtc parses to { hour, minute }", () => {
  assert.deepEqual(slotTimeUtc("00:00"), { hour: 0, minute: 0 });
  assert.deepEqual(slotTimeUtc("12:00"), { hour: 12, minute: 0 });
});

// ---- PublishSchedule ---------------------------------------------

test("isPublishSchedule / validatePublishSchedule", () => {
  assert.ok(isPublishSchedule({ kind: "immediate" }));
  assert.ok(isPublishSchedule({ kind: "slot", slot: "12:00" }));
  assert.equal(isPublishSchedule({ kind: "slot", slot: "09:00" }), false);
  assert.equal(isPublishSchedule({ kind: "later" }), false);
  assert.equal(isPublishSchedule(null), false);

  assert.equal(validatePublishSchedule({ kind: "immediate" }).valid, true);
  assert.equal(validatePublishSchedule({ kind: "slot", slot: "00:00" }).valid, true);
  assert.equal(validatePublishSchedule({ kind: "slot", slot: "13:00" }).valid, false);
  assert.equal(validatePublishSchedule({ kind: "bogus" }).valid, false);
  assert.equal(validatePublishSchedule("nope").valid, false);
});

// ---- nextSlotOccurrence: DETERMINISTIC -----------------------------

test("nextSlotOccurrence: a future same-day slot stays today", () => {
  const from = new Date("2026-09-10T09:15:00.000Z");
  assert.equal(nextSlotOccurrence("12:00", from).toISOString(), "2026-09-10T12:00:00.000Z");
});

test("nextSlotOccurrence: a past same-day slot rolls to tomorrow", () => {
  const from = new Date("2026-09-10T09:15:00.000Z");
  assert.equal(nextSlotOccurrence("00:00", from).toISOString(), "2026-09-11T00:00:00.000Z");
});

test("nextSlotOccurrence: exactly AT the slot instant rolls to tomorrow (strictly-after)", () => {
  const from = new Date("2026-09-10T12:00:00.000Z");
  assert.equal(nextSlotOccurrence("12:00", from).toISOString(), "2026-09-11T12:00:00.000Z");
});

test("nextSlotOccurrence: crosses a month/year boundary correctly", () => {
  assert.equal(
    nextSlotOccurrence("00:00", new Date("2026-12-31T23:59:59.000Z")).toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
});

test("nextSlotOccurrence: same input -> same output (pure), 100x", () => {
  const from = new Date("2026-09-10T09:15:00.000Z");
  const first = nextSlotOccurrence("12:00", from).toISOString();
  for (let i = 0; i < 100; i++) {
    assert.equal(nextSlotOccurrence("12:00", new Date(from.getTime())).toISOString(), first);
  }
});

test("nextSlotOccurrence: always strictly in the future relative to `from`", () => {
  for (const slot of PUBLISHING_SLOTS) {
    for (const iso of [
      "2026-01-01T00:00:00.000Z",
      "2026-06-15T11:59:59.999Z",
      "2026-06-15T12:00:00.000Z",
      "2026-06-15T23:59:59.999Z",
    ]) {
      const from = new Date(iso);
      assert.ok(nextSlotOccurrence(slot as PublishingSlot, from).getTime() > from.getTime());
    }
  }
});

// ---- resolveScheduledFor -----------------------------------------

test("resolveScheduledFor: immediate -> null", () => {
  assert.equal(resolveScheduledFor(IMMEDIATE_SCHEDULE, new Date("2026-09-10T09:00:00.000Z")), null);
  assert.equal(resolveScheduledFor({ kind: "immediate" }, new Date()), null);
});

test("resolveScheduledFor: slot -> the next occurrence ISO string", () => {
  const now = new Date("2026-09-10T09:00:00.000Z");
  assert.equal(resolveScheduledFor({ kind: "slot", slot: "12:00" }, now), "2026-09-10T12:00:00.000Z");
  assert.equal(resolveScheduledFor({ kind: "slot", slot: "00:00" }, now), "2026-09-11T00:00:00.000Z");
});

// ---- the ONE daily cron declaration ------------------------------

const vercel = JSON.parse(readFileSync(join(FRONTEND, "vercel.json"), "utf8")) as {
  crons?: { path: string; schedule: string }[];
};

test("vercel.json declares exactly ONE cron for the publishing dispatcher", () => {
  const crons = vercel.crons ?? [];
  const dispatch = crons.filter((c) => c.path === "/api/private/publishing/dispatch");
  assert.equal(dispatch.length, 1, `expected 1, found ${dispatch.length}`);
});

test("the publishing dispatch cron is DAILY (Hobby: one run/path/day)", () => {
  const c = (vercel.crons ?? []).find((x) => x.path === "/api/private/publishing/dispatch")!;
  // 5-field cron; a DAILY schedule pins minute+hour and leaves DOM/MONTH/DOW = "*"
  const parts = c.schedule.trim().split(/\s+/);
  assert.equal(parts.length, 5, `cron must have 5 fields, got "${c.schedule}"`);
  const [min, hour, dom, mon, dow] = parts;
  assert.match(min, /^\d+$/, "minute must be a fixed number");
  assert.match(hour, /^\d+$/, "hour must be a fixed number (a single daily run)");
  assert.equal(dom, "*", "day-of-month must be *");
  assert.equal(mon, "*", "month must be *");
  assert.equal(dow, "*", "day-of-week must be *");
});

test("no sub-daily cron anywhere in vercel.json (would block all deploys on Hobby)", () => {
  for (const c of vercel.crons ?? []) {
    const [min, hour] = c.schedule.trim().split(/\s+/);
    assert.match(min, /^\d+$/, `${c.path}: minute must be fixed (no "*" / "*/n")`);
    assert.match(hour, /^\d+$/, `${c.path}: hour must be fixed (no "*" / "*/n")`);
  }
});

// ---- the dispatch route is auth-protected ------------------------

test("dispatch route uses cron-secret OR admin auth (not a plain session)", () => {
  const src = readFileSync(join(FRONTEND, "app/api/private/publishing/dispatch/route.ts"), "utf8");
  assert.ok(src.includes("isValidCronSecret"), "must check isValidCronSecret");
  assert.ok(src.includes("requireAdmin"), "must fall back to requireAdmin");
  assert.ok(/export const maxDuration\s*=\s*60/.test(src), "must cap maxDuration at 60");
  assert.ok(!/getUserOrNull/.test(src), "must NOT gate on a plain logged-in user");
});

test("proxy.ts exempts the publishing dispatch cron path (else the session gate 401s Vercel Cron before the route runs)", () => {
  const src = readFileSync(join(FRONTEND, "proxy.ts"), "utf8");
  // the exempt set must literally carry the dispatcher path...
  assert.ok(
    /CRON_SECRET_EXEMPT_PATHS\s*=\s*new Set\(\[[^\]]*"\/api\/private\/publishing\/dispatch"[^\]]*\]\)/.test(src),
    "'/api/private/publishing/dispatch' must be in CRON_SECRET_EXEMPT_PATHS",
  );
  // ...and the exemption must still be gated by a valid cron secret, not a blanket bypass
  assert.ok(
    /CRON_SECRET_EXEMPT_PATHS\.has\([^)]*\)\s*&&\s*isValidCronSecret\(/.test(src),
    "the exemption must require isValidCronSecret(), not just a path match",
  );
});

test("the POST publish-jobs route validates an unknown schedule shape", () => {
  const src = readFileSync(
    join(FRONTEND, "app/api/private/publishing/articles/[id]/publish-jobs/route.ts"),
    "utf8",
  );
  assert.ok(src.includes("validatePublishSchedule"), "must validate the schedule from the body");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
