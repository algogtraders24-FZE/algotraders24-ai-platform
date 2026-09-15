// scripts/validate-automation-scheduler.ts
// AT24 Automation (MVP) - preset-slot scheduler logic (pure).
// `npm run validate:automation-scheduler`. Covers AUTOMATION_TEST_PLAN.md §1
// (trigger timing) + slot-registry wiring.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AUTOMATION_SLOTS,
  getSlot,
  slotInstantForIstDay,
  istWeekday,
  allDispatchPaths,
} from "../config/automation-slots";
import { computeNextRunAt, isDueForSlot } from "../services/automation/scheduler";
import type { AutomationWorkflowDefinition } from "../types/automation";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const morning = getSlot("morning_ist")!;
const evening = getSlot("evening_ist")!;

function def(trigger: AutomationWorkflowDefinition["trigger"]): AutomationWorkflowDefinition {
  return { schemaVersion: 1, trigger, steps: [] };
}

async function main(): Promise<void> {
  console.log("validate-automation-scheduler\n");

  test("slot registry: 2 Beta slots, IST-derived UTC crons", () => {
    assert.equal(AUTOMATION_SLOTS.length, 2);
    assert.equal(morning.cron, "30 2 * * *"); // 08:00 IST = 02:30 UTC
    assert.equal(evening.cron, "0 13 * * *"); // 18:30 IST = 13:00 UTC
  });

  test("every cron is a plain daily expression (Hobby-legal)", () => {
    for (const s of AUTOMATION_SLOTS) {
      assert.match(s.cron, /^\d{1,2} \d{1,2} \* \* \*$/, `slot ${s.id} cron "${s.cron}" is not <min> <hour> * * *`);
    }
  });

  test("dispatch paths are distinct pathnames", () => {
    const paths = allDispatchPaths();
    assert.equal(new Set(paths).size, paths.length);
    for (const p of paths) assert.ok(p.startsWith("/api/private/automations/cron/dispatch/"));
  });

  test("slot registry <-> vercel.json <-> proxy.ts are in lockstep", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const proxySrc = readFileSync(join(root, "proxy.ts"), "utf8");
    for (const slot of AUTOMATION_SLOTS) {
      const cron = vercel.crons.find((c) => c.path === slot.dispatchPath);
      assert.ok(cron, `vercel.json is missing a cron for ${slot.dispatchPath}`);
      assert.equal(cron.schedule, slot.cron, `vercel.json cron for ${slot.id} != slot.cron`);
      assert.ok(
        proxySrc.includes(`"${slot.dispatchPath}"`),
        `proxy.ts CRON_SECRET_EXEMPT_PATHS is missing ${slot.dispatchPath}`,
      );
      // route file exists
      const routeRel = slot.dispatchPath.replace("/api/", "app/api/") + "/route.ts";
      assert.doesNotThrow(
        () => readFileSync(join(root, routeRel), "utf8"),
        `route file missing: ${routeRel}`,
      );
    }
  });

  test("slotInstantForIstDay lands on the right UTC instant", () => {
    // 2026-10-06 (a Tuesday). Morning slot 08:00 IST => 02:30 UTC.
    const anchor = new Date("2026-10-06T00:00:00Z");
    const inst = slotInstantForIstDay(morning, anchor);
    assert.equal(inst.toISOString(), "2026-10-06T02:30:00.000Z");
    assert.equal(istWeekday(inst), "TUE");
  });

  test("daily is always due at its slot", () => {
    const now = new Date("2026-10-06T02:30:00Z");
    const r = isDueForSlot({ def: def({ type: "daily", timezone: "Asia/Kolkata", slot: "morning_ist" }), slot: morning, now, hasAnyRun: false });
    assert.equal(r.due, true);
    assert.equal(r.slotInstant.toISOString(), "2026-10-06T02:30:00.000Z");
  });

  test("daily targeting a different slot is not due", () => {
    const now = new Date("2026-10-06T13:00:00Z");
    const r = isDueForSlot({ def: def({ type: "daily", timezone: "Asia/Kolkata", slot: "morning_ist" }), slot: evening, now, hasAnyRun: false });
    assert.equal(r.due, false);
  });

  test("weekly fires only on its IST weekdays", () => {
    // 2026-10-06 is a Tuesday in IST.
    const now = new Date("2026-10-06T02:30:00Z");
    const wednesdayOnly = def({ type: "weekly", timezone: "Asia/Kolkata", slot: "morning_ist", daysOfWeek: ["WED"] });
    const tuesdayIncl = def({ type: "weekly", timezone: "Asia/Kolkata", slot: "morning_ist", daysOfWeek: ["MON", "TUE", "WED"] });
    assert.equal(isDueForSlot({ def: wednesdayOnly, slot: morning, now, hasAnyRun: false }).due, false);
    assert.equal(isDueForSlot({ def: tuesdayIncl, slot: morning, now, hasAnyRun: false }).due, true);
  });

  test("once is due once runAt is reached, and only if it has no prior run", () => {
    const now = new Date("2026-10-06T02:30:00Z");
    const d = def({ type: "once", timezone: "Asia/Kolkata", slot: "morning_ist", runAt: "2026-10-05T00:00:00Z" });
    assert.equal(isDueForSlot({ def: d, slot: morning, now, hasAnyRun: false }).due, true);
    assert.equal(isDueForSlot({ def: d, slot: morning, now, hasAnyRun: true }).due, false);
    const future = def({ type: "once", timezone: "Asia/Kolkata", slot: "morning_ist", runAt: "2026-12-01T00:00:00Z" });
    assert.equal(isDueForSlot({ def: future, slot: morning, now, hasAnyRun: false }).due, false);
  });

  test("computeNextRunAt: daily -> next slot strictly after now", () => {
    const from = new Date("2026-10-06T05:00:00Z"); // after this morning's 02:30 pass
    const next = computeNextRunAt(def({ type: "daily", timezone: "Asia/Kolkata", slot: "morning_ist" }), from);
    assert.equal(next?.toISOString(), "2026-10-07T02:30:00.000Z");
  });

  test("computeNextRunAt: weekly -> next matching IST weekday", () => {
    const from = new Date("2026-10-06T05:00:00Z"); // Tue
    const next = computeNextRunAt(
      def({ type: "weekly", timezone: "Asia/Kolkata", slot: "evening_ist", daysOfWeek: ["FRI"] }),
      from,
    );
    // Next Friday 18:30 IST = 13:00 UTC on 2026-10-09
    assert.equal(next?.toISOString(), "2026-10-09T13:00:00.000Z");
  });

  test("computeNextRunAt: manual -> null; once-already-ran -> null", () => {
    assert.equal(computeNextRunAt(def({ type: "manual", timezone: "Asia/Kolkata" }), new Date()), null);
    assert.equal(
      computeNextRunAt(def({ type: "once", timezone: "Asia/Kolkata", slot: "morning_ist", runAt: "2026-10-05T00:00:00Z" }), new Date(), {
        onceAlreadyRan: true,
      }),
      null,
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
