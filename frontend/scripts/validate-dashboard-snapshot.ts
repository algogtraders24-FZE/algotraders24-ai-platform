// scripts/validate-dashboard-snapshot.ts
// Dashboard "Market snapshot": the overview aggregation, the next-risk-event
// picker and the countdown. Pure/in-memory (fake fetch). `npm run validate:dashboard-snapshot`.

process.env.TWELVEDATA_API_KEY = "test-key";
process.env.FRED_API_KEY = "test-fred";

import assert from "node:assert/strict";
import { pickNextHighImpactEvent } from "../services/calendar/next-event";
import { countdown } from "../services/automation/brief-extras";
import { getMacroOverview, toOverviewItem, OVERVIEW_ORDER } from "../services/macro/macro-overview";
import { resetMacroCacheForTests, type FetchLike } from "../services/macro/macro-data";
import { ASSET_IDS } from "../services/macro/macro-alignment";

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

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const PCT: Record<string, string> = { "XAU/USD": "0.40", UUP: "-0.30", IEF: "0.20", VIXY: "-1.50", QQQ: "0.80", "EUR/USD": "0.25", "USD/JPY": "0.35", "BTC/USD": "2.50", USO: "1.90" };
const goodFetch: FetchLike = async (url) => {
  if (url.includes("stlouisfed")) {
    const vals = [2.87, 2.9, 2.92, 2.95, 2.98, 3.02, 3, 3, 3, 3];
    return json({ observations: vals.map((v, i) => ({ date: `2026-10-${String(9 - i).padStart(2, "0")}`, value: String(v) })) });
  }
  const sym = decodeURIComponent(new URL(url).searchParams.get("symbol") ?? "");
  return json({ close: "100", percent_change: PCT[sym], last_quote_at: 1791815280 });
};

async function main(): Promise<void> {
  console.log("validate-dashboard-snapshot\n");

  const NOW = new Date("2026-10-13T06:00:00Z");
  const ev = (over: Record<string, unknown>) => ({ title: "CPI", currency: "USD", impact: "high" as const, isHoliday: false, allDay: false, eventTime: "2026-10-13T12:30:00Z", forecast: "3.1%", previous: "3.0%", ...over });

  await test("next event: earliest upcoming high-impact, timed, non-holiday", () => {
    const n = pickNextHighImpactEvent(
      [
        ev({ title: "Later", eventTime: "2026-10-15T12:30:00Z" }),
        ev({ title: "Past", eventTime: "2026-10-13T01:00:00Z" }),
        ev({ title: "Holiday", isHoliday: true, eventTime: "2026-10-13T07:00:00Z" }),
        ev({ title: "Low", impact: "low", eventTime: "2026-10-13T07:00:00Z" }),
        ev({ title: "AllDay", allDay: true, eventTime: "2026-10-13T07:00:00Z" }),
        ev({ title: "Next", eventTime: "2026-10-13T12:30:00Z" }),
      ],
      NOW,
    );
    assert.equal(n?.title, "Next");
    assert.equal(n?.forecast, "3.1%");
  });

  await test("next event: none left -> null (the card says so)", () => {
    assert.equal(pickNextHighImpactEvent([], NOW), null);
    assert.equal(pickNextHighImpactEvent([ev({ eventTime: "2026-10-12T12:30:00Z" })], NOW), null);
  });

  await test("next event: garbage dates are skipped, never throw", () => {
    assert.equal(pickNextHighImpactEvent([ev({ eventTime: "not-a-date" })], NOW), null);
  });

  await test("countdown handles minutes, hours and days", () => {
    assert.equal(countdown(45 * 60000), "in 45m");
    assert.equal(countdown(3 * 3600000 + 20 * 60000), "in 3h 20m");
    assert.equal(countdown(50 * 3600000), "in 2d 2h");
    assert.equal(countdown(-5), "now");
  });

  await test("overview: all five assets, display order stable, fetched in priority order", async () => {
    resetMacroCacheForTests();
    const order: string[] = [];
    const spy: FetchLike = async (u) => {
      if (u.includes("twelvedata")) order.push(decodeURIComponent(new URL(u).searchParams.get("symbol") ?? ""));
      return goodFetch(u);
    };
    const items = await getMacroOverview(spy);
    assert.deepEqual(items.map((i) => i.asset), ASSET_IDS);
    assert.deepEqual([...OVERVIEW_ORDER].sort(), [...ASSET_IDS].sort());
    assert.ok(items.every((i) => i.totalDrivers >= 4 && i.price !== null));
    // gold's quotes come before bitcoin's, which come before the oil ETF
    assert.ok(order.indexOf("XAU/USD") < order.indexOf("BTC/USD"));
    assert.ok(order.indexOf("BTC/USD") < order.indexOf("USO"));
    resetMacroCacheForTests();
  });

  await test("overview: shared quotes are fetched once (9 unique Twelve Data symbols for all five assets)", async () => {
    resetMacroCacheForTests();
    const symbols: string[] = [];
    const spy: FetchLike = async (u) => {
      if (u.includes("twelvedata")) symbols.push(decodeURIComponent(new URL(u).searchParams.get("symbol") ?? ""));
      return goodFetch(u);
    };
    await getMacroOverview(spy);
    assert.equal(symbols.length, new Set(symbols).size, `duplicate fetches: ${symbols.join(",")}`);
    assert.equal(symbols.length, 9);
    resetMacroCacheForTests();
  });

  await test("overview: a failing source degrades that asset only; the others still score", async () => {
    resetMacroCacheForTests();
    const noOil: FetchLike = async (u) => (u.includes("symbol=USO") ? json({ code: 429, status: "error" }) : goodFetch(u));
    const items = await getMacroOverview(noOil);
    const oil = items.find((i) => i.asset === "oil")!;
    const gold = items.find((i) => i.asset === "gold")!;
    assert.equal(oil.price, null);
    assert.ok(gold.score !== null && gold.price !== null);
    resetMacroCacheForTests();
  });

  await test("toOverviewItem carries the same numbers as the full snapshot (no recomputation)", () => {
    const item = toOverviewItem({
      asset: "gold", title: "Gold", fetchedAt: "", attribution: null, price: { label: "Gold", text: "$1", changePct: 1 },
      alignment: { asset: "gold", lean: "supportive", score: 75, label: "Supports gold", drivers: [], availableDrivers: 4, totalDrivers: 5, formula: "", caveat: "", notCovered: [] },
    });
    assert.deepEqual([item.score, item.lean, item.label, item.availableDrivers, item.totalDrivers], [75, "supportive", "Supports gold", 4, 5]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
