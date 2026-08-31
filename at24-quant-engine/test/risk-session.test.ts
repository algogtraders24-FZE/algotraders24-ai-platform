import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSessionEligibility, isWithinAnySessionWindow } from "../src/runtime/risk/session.js";
import type { RiskSpecification, SessionHoursRule } from "../src/domain/risk-specification.js";

const sessionSpec = (windows: SessionHoursRule): RiskSpecification => ({
  sizing: { method: "fixed-lot", lots: 1 },
  sessionHours: windows,
});

test("no sessionHours configured: always passes", () => {
  const result = evaluateSessionEligibility({ sizing: { method: "fixed-lot", lots: 1 } }, Date.parse("2026-06-01T03:00:00Z"));
  assert.equal(result.passed, true);
});

test("inside session passes", () => {
  const spec = sessionSpec({ timezone: "UTC", windows: [{ startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 }] });
  assert.equal(evaluateSessionEligibility(spec, Date.parse("2026-06-01T12:00:00Z")).passed, true);
});

test("before session is REJECTED", () => {
  const spec = sessionSpec({ timezone: "UTC", windows: [{ startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 }] });
  const result = evaluateSessionEligibility(spec, Date.parse("2026-06-01T06:00:00Z"));
  assert.equal(result.passed, false);
  assert.equal(result.violation!.code, "SESSION_RESTRICTION");
});

test("after session is REJECTED", () => {
  const spec = sessionSpec({ timezone: "UTC", windows: [{ startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 }] });
  assert.equal(evaluateSessionEligibility(spec, Date.parse("2026-06-01T18:00:00Z")).passed, false);
});

test("exact start boundary is INSIDE the window (half-open [start, end))", () => {
  const spec = sessionSpec({ timezone: "UTC", windows: [{ startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 }] });
  assert.equal(evaluateSessionEligibility(spec, Date.parse("2026-06-01T08:00:00Z")).passed, true);
});

test("exact end boundary is OUTSIDE the window (half-open [start, end))", () => {
  const spec = sessionSpec({ timezone: "UTC", windows: [{ startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 }] });
  assert.equal(evaluateSessionEligibility(spec, Date.parse("2026-06-01T16:00:00Z")).passed, false);
});

test("overnight session expressed as two windows (documented Q0.2 limitation workaround)", () => {
  const spec = sessionSpec({
    timezone: "UTC",
    windows: [
      { startHour: 22, startMinute: 0, endHour: 23, endMinute: 59 },
      { startHour: 0, startMinute: 0, endHour: 6, endMinute: 0 },
    ],
  });
  assert.equal(evaluateSessionEligibility(spec, Date.parse("2026-06-01T23:30:00Z")).passed, true);
  assert.equal(evaluateSessionEligibility(spec, Date.parse("2026-06-02T02:00:00Z")).passed, true);
  assert.equal(evaluateSessionEligibility(spec, Date.parse("2026-06-01T12:00:00Z")).passed, false);
});

test("an invalid IANA timezone is rejected deterministically, not thrown as an uncaught error", () => {
  const spec = sessionSpec({ timezone: "Not/A_Real_Zone", windows: [{ startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 }] });
  const result = evaluateSessionEligibility(spec, Date.parse("2026-06-01T12:00:00Z"));
  assert.equal(result.passed, false);
  assert.equal(result.violation!.reason, "INVALID_CONFIGURATION");
});

test("timezone conversion: the same UTC instant is inside a window in one timezone and outside it in another", () => {
  // 2026-06-01T12:00:00Z is 08:00 in America/New_York (EDT, UTC-4 in June)
  const nyMorningWindow = { timezone: "America/New_York", windows: [{ startHour: 7, startMinute: 0, endHour: 9, endMinute: 0 }] };
  const utcMorningWindow = { timezone: "UTC", windows: [{ startHour: 7, startMinute: 0, endHour: 9, endMinute: 0 }] };
  const instant = Date.parse("2026-06-01T12:00:00Z");
  assert.equal(isWithinAnySessionWindow(instant, nyMorningWindow), true);
  assert.equal(isWithinAnySessionWindow(instant, utcMorningWindow), false);
});
