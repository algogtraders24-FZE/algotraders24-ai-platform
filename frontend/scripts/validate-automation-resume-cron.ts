// scripts/validate-automation-resume-cron.ts
// The every-2-minutes resume cron (permanent fix for runs left stalled by a killed
// function - found 2026-10-13). Wiring + behaviour, no DB, no network.
// `npm run validate:automation-resume-cron`.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AUTOMATION_RESUME_CRON, AUTOMATION_SLOTS } from "../config/automation-slots";
import { resumeStalledRuns } from "../services/automation/run-dispatch";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

async function main(): Promise<void> {
  console.log("validate-automation-resume-cron\n");

  await test("vercel.json registers the resume cron every 2 minutes, exactly once", () => {
    const crons = JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[];
    const m = crons.filter((c) => c.path === AUTOMATION_RESUME_CRON.path);
    assert.equal(m.length, 1);
    assert.equal(m[0].schedule, "*/2 * * * *");
    assert.equal(AUTOMATION_RESUME_CRON.schedule, m[0].schedule);
  });

  await test("the daily slot crons are unchanged (still daily, fixed minute + hour)", () => {
    const crons = JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[];
    for (const slot of AUTOMATION_SLOTS) {
      const c = crons.find((x) => x.path === slot.dispatchPath);
      assert.ok(c, slot.id);
      assert.equal(c.schedule, slot.cron);
      assert.match(c.schedule, /^\d+ \d+ \* \* \*$/);
    }
  });

  await test("it is the ONLY sub-daily cron in vercel.json", () => {
    const crons = JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[];
    const sub = crons.filter((c) => !/^\d+ \d+ \* \* \*$/.test(c.schedule.trim()));
    assert.deepEqual(sub.map((c) => c.path), [AUTOMATION_RESUME_CRON.path]);
  });

  await test("proxy.ts exempts the resume path (else the session gate 401s Vercel Cron before the route runs)", () => {
    const src = read("proxy.ts");
    const set = src.slice(src.indexOf("CRON_SECRET_EXEMPT_PATHS = new Set"), src.indexOf("]);", src.indexOf("CRON_SECRET_EXEMPT_PATHS = new Set")));
    assert.ok(set.includes(`"${AUTOMATION_RESUME_CRON.path}"`));
  });

  await test("route file exists, maxDuration 300, auth = cron secret or admin (never a plain user)", () => {
    const file = "app/api/private/automations/cron/resume/route.ts";
    assert.ok(existsSync(join(ROOT, file)));
    assert.match(read(file), /export const maxDuration = 300;/);
    const handler = read("services/automation/cron-route.ts");
    const body = handler.slice(handler.indexOf("export function resumeStalledRoute"), handler.indexOf("export function slotDispatchRoute"));
    assert.ok(body.includes("isValidCronSecret") && body.includes("requireAdmin"));
    assert.ok(!body.includes("getUserOrNull"));
  });

  await test("resumeStalledRuns dispatches every stalled run once and reports counts", async () => {
    const seen: string[] = [];
    const r = await resumeStalledRuns({
      list: async () => [{ id: "a" }, { id: "b" }, { id: "c" }],
      dispatch: async (id) => (seen.push(id), id !== "b"),
    });
    assert.deepEqual([...seen].sort(), ["a", "b", "c"]);
    assert.equal(r.found, 3);
    assert.equal(r.resumed, 2); // "b" failed to dispatch
  });

  await test("resumeStalledRuns with nothing stalled is a cheap no-op", async () => {
    let dispatched = 0;
    const r = await resumeStalledRuns({ list: async () => [], dispatch: async () => (dispatched += 1, true) });
    assert.deepEqual([r.found, r.resumed, dispatched], [0, 0, 0]);
  });

  await test("resumeStalledRuns asks for runs idle for 2 minutes, at most 25", async () => {
    let args: [number, number] | null = null;
    await resumeStalledRuns({ list: async (ms, limit) => ((args = [ms, limit]), []), dispatch: async () => true });
    assert.deepEqual(args, [120_000, 25]);
  });

  await test("a failed dispatch is counted as not resumed, and the sweep still reports", async () => {
    const r = await resumeStalledRuns({ list: async () => [{ id: "x" }], dispatch: async () => false });
    assert.equal(r.resumed, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
