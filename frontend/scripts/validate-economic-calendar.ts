// scripts/validate-economic-calendar.ts
// AN2 - standalone validation for the Economic Calendar feature. No test
// framework exists in this project; run via `npm run validate:economic-calendar`.
//
// No real network call is ever made: the HTTP transport is a controlled
// fake passed as fetchFairEconomyWeek's / getEconomicCalendar's optional
// fetchImpl argument. Self-cleaning: every test builds its own inputs, and
// the two tests that set process.env restore it in a finally block.
//
// Run with `--conditions=react-server` (wired into the npm script) so the
// `import "server-only"` guard in the provider/normalize modules resolves
// to its empty stub instead of throwing outside an RSC context.
import assert from "node:assert/strict";
import { normalizeFairEconomyEvent, normalizeFairEconomyFeed } from "../services/calendar/normalize.service";
import { fetchFairEconomyWeek, CalendarProviderError, type RawFairEconomyEvent } from "../services/calendar/faireconomy.provider";
import { getEconomicCalendar } from "../services/calendar/calendar.service";

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

function jsonResponse(body: unknown, init?: { status?: number; ok?: boolean }): Response {
  const status = init?.status ?? 200;
  return {
    ok: init?.ok ?? (status >= 200 && status < 300),
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A realistic feed row, matching the real fetch made during AN2 design. */
const REAL_ROW: RawFairEconomyEvent = {
  title: "Main Refinancing Rate",
  country: "EUR",
  date: "2026-09-10T08:15:00-04:00",
  impact: "High",
  forecast: "2.65%",
  previous: "2.40%",
};

async function main() {
  console.log("AN2 - Economic Calendar validation\n");

  // ---- normalizeFairEconomyEvent ----------------------------------------
  await test("normalizes a real row to the typed contract", () => {
    const event = normalizeFairEconomyEvent(REAL_ROW);
    assert.ok(event);
    assert.equal(event.title, "Main Refinancing Rate");
    assert.equal(event.currency, "EUR");
    assert.equal(event.impact, "high");
    assert.equal(event.isHoliday, false);
    assert.equal(event.forecast, "2.65%");
    assert.equal(event.previous, "2.40%");
    assert.equal(event.actual, null, "free feed never carries actual");
    assert.equal(event.eventTime, "2026-09-10T12:15:00.000Z", "US-Eastern offset converted to UTC");
    assert.match(event.id, /^[0-9a-f]{16}$/);
  });

  await test("folds Holiday impact to low and flags isHoliday", () => {
    const event = normalizeFairEconomyEvent({ ...REAL_ROW, title: "Bank Holiday", impact: "Holiday", country: "All" });
    assert.ok(event);
    assert.equal(event.impact, "low");
    assert.equal(event.isHoliday, true);
    assert.equal(event.currency, "ALL", "'All' country becomes the ALL sentinel");
  });

  await test("empty forecast/previous become null, not empty string", () => {
    const event = normalizeFairEconomyEvent({ ...REAL_ROW, forecast: "", previous: "   " });
    assert.ok(event);
    assert.equal(event.forecast, null);
    assert.equal(event.previous, null);
  });

  await test("drops rows that cannot be trusted", () => {
    assert.equal(normalizeFairEconomyEvent({ ...REAL_ROW, title: "  " }), null, "blank title");
    assert.equal(normalizeFairEconomyEvent({ ...REAL_ROW, country: undefined }), null, "missing country");
    assert.equal(normalizeFairEconomyEvent({ ...REAL_ROW, date: "not-a-date" }), null, "unparseable date");
    assert.equal(normalizeFairEconomyEvent({ ...REAL_ROW, impact: "Critical" }), null, "unknown impact");
    assert.equal(normalizeFairEconomyEvent({ title: 42, country: "EUR", date: REAL_ROW.date } as RawFairEconomyEvent), null, "non-string title");
  });

  await test("id is stable across identical rows and differs on any key field", () => {
    const a = normalizeFairEconomyEvent(REAL_ROW)!;
    const b = normalizeFairEconomyEvent({ ...REAL_ROW })!;
    const c = normalizeFairEconomyEvent({ ...REAL_ROW, title: "Deposit Facility Rate" })!;
    assert.equal(a.id, b.id);
    assert.notEqual(a.id, c.id);
  });

  // ---- normalizeFairEconomyFeed ---------------------------------------
  await test("feed normalization de-dupes and sorts chronologically", () => {
    const events = normalizeFairEconomyFeed([
      { ...REAL_ROW, title: "Later Event", date: "2026-09-11T02:00:00-04:00", impact: "Low" },
      REAL_ROW,
      REAL_ROW, // exact duplicate
      { ...REAL_ROW, title: "Bad", impact: "???" }, // dropped
    ]);
    assert.equal(events.length, 2, "duplicate collapsed, invalid dropped");
    assert.ok(events[0].eventTime < events[1].eventTime, "sorted ascending by time");
    assert.equal(events[0].title, "Main Refinancing Rate");
  });

  // ---- fetchFairEconomyWeek ------------------------------------------
  await test("fetchFairEconomyWeek returns the raw array on success", async () => {
    const rows = await fetchFairEconomyWeek("this", async () => jsonResponse([REAL_ROW]));
    assert.deepEqual(rows, [REAL_ROW]);
  });

  await test("fetchFairEconomyWeek throws http_error on non-2xx", async () => {
    await assert.rejects(
      () => fetchFairEconomyWeek("this", async () => jsonResponse("nope", { status: 404 })),
      (err: unknown) => err instanceof CalendarProviderError && err.kind === "http_error",
    );
  });

  await test("fetchFairEconomyWeek throws invalid_response when body is not an array", async () => {
    await assert.rejects(
      () => fetchFairEconomyWeek("this", async () => jsonResponse({ not: "an array" })),
      (err: unknown) => err instanceof CalendarProviderError && err.kind === "invalid_response",
    );
  });

  await test("fetchFairEconomyWeek throws invalid_response when JSON parse fails", async () => {
    const badResponse = { ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } } as unknown as Response;
    await assert.rejects(
      () => fetchFairEconomyWeek("this", async () => badResponse),
      (err: unknown) => err instanceof CalendarProviderError && err.kind === "invalid_response",
    );
  });

  await test("fetchFairEconomyWeek requests the configured base URL and thisweek file", async () => {
    const seen: string[] = [];
    const original = process.env.CALENDAR_FEED_BASE_URL;
    process.env.CALENDAR_FEED_BASE_URL = "https://example.test/feeds";
    try {
      await fetchFairEconomyWeek("this", async (input) => {
        seen.push(String(input));
        return jsonResponse([]);
      });
      assert.equal(seen[0], "https://example.test/feeds/ff_calendar_thisweek.json");
    } finally {
      if (original === undefined) delete process.env.CALENDAR_FEED_BASE_URL;
      else process.env.CALENDAR_FEED_BASE_URL = original;
    }
  });

  // ---- getEconomicCalendar (filters + freshness) ----------------------
  const FEED: RawFairEconomyEvent[] = [
    { title: "US CPI m/m", country: "USD", date: "2026-09-10T08:30:00-04:00", impact: "High", forecast: "0.2%", previous: "0.1%" },
    { title: "US Unemployment Claims", country: "USD", date: "2026-09-11T08:30:00-04:00", impact: "Medium", forecast: "230K", previous: "228K" },
    { title: "German Trade Balance", country: "EUR", date: "2026-09-09T02:00:00-04:00", impact: "Low", forecast: "", previous: "18.2B" },
  ];

  await test("no filters returns every normalized event", async () => {
    const result = await getEconomicCalendar({ week: "this" }, async () => jsonResponse(FEED));
    assert.equal(result.events.length, 3);
    assert.equal(result.week, "this");
    assert.equal(result.freshness.isStale, false);
    assert.ok(result.freshness.source.length > 0);
    assert.match(result.freshness.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  await test("currency filter is applied (case-insensitive)", async () => {
    const result = await getEconomicCalendar({ week: "this", currencies: ["usd"] }, async () => jsonResponse(FEED));
    assert.equal(result.events.length, 2);
    assert.ok(result.events.every((e) => e.currency === "USD"));
  });

  await test("impact filter is applied", async () => {
    const result = await getEconomicCalendar({ week: "this", impacts: ["high"] }, async () => jsonResponse(FEED));
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].title, "US CPI m/m");
  });

  await test("currency + impact filters compose", async () => {
    const result = await getEconomicCalendar({ week: "this", currencies: ["USD"], impacts: ["medium"] }, async () => jsonResponse(FEED));
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].title, "US Unemployment Claims");
  });

  await test("provider failure propagates (route turns it into a 502)", async () => {
    await assert.rejects(
      () => getEconomicCalendar({ week: "this" }, async () => jsonResponse("x", { status: 500 })),
      (err: unknown) => err instanceof CalendarProviderError,
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
