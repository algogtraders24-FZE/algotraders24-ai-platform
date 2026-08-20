// scripts/validate-chart-drawing-persistence.ts
// Sprint D2.7.11 Phase 1b - durable, cross-session persistence for chart
// drawn objects. Exercises services/chart/chart-drawing.service.ts against
// the REAL database (the ChartDrawingSet table added by this sprint's
// migration), not a fake - the same "real data, self-cleaning" convention
// established for every other DB-backed service test in this project (see
// e.g. validate-conversation-hardening.ts). Synthetic
// chartdrawing<timestamp>-tagged user, hard-deleted in a `finally` block.
// The client-side store.ts/store fetch-mock coverage lives in
// validate-native-chart-drawing-tools.ts - this script covers the server
// side only: the service's own validation rules and real Postgres upsert/
// replace semantics.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { chartDrawingService } from "../services/chart/chart-drawing.service";
import { createTrendLine, createFibonacci, createHorizontalLine } from "../lib/chart-engine/drawing/types";

const RUN_TAG = `chartdrawing-${Date.now()}`;

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

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `${RUN_TAG}@internal.test`, name: "Chart Drawing Persistence Test User" } });

  try {
    await test("get() returns an empty array for a symbol/timeframe with nothing saved yet - never throws, never fabricates a default object", async () => {
      const objects = await chartDrawingService.get(user.id, "XAUUSD", "1h");
      assert.deepEqual(objects, []);
    });

    await test("save() then get() round-trips the exact objects through a REAL Postgres upsert, surviving a fresh read (not just an in-memory echo)", async () => {
      const line = createTrendLine({ time: 0, price: 1000 }, { time: 500, price: 1050 }, 1000);
      await chartDrawingService.save(user.id, "XAUUSD", "1h", [line]);
      const objects = await chartDrawingService.get(user.id, "XAUUSD", "1h");
      assert.deepEqual(objects, [line]);
    });

    await test("save() replaces the WHOLE array for that key (never merges/appends) - matching NativeChart.tsx's own commit-the-full-set semantics", async () => {
      const fib = createFibonacci({ time: 0, price: 1000 }, { time: 500, price: 1050 }, 2000);
      await chartDrawingService.save(user.id, "XAUUSD", "1h", [fib]);
      const objects = await chartDrawingService.get(user.id, "XAUUSD", "1h");
      assert.deepEqual(objects, [fib], "the earlier trend line must be GONE, not merged alongside the new fibonacci");
    });

    await test("save() with an empty array (a delete-all / 'Clear all') persists as genuinely empty, not left over from a prior save", async () => {
      await chartDrawingService.save(user.id, "XAUUSD", "1h", []);
      const objects = await chartDrawingService.get(user.id, "XAUUSD", "1h");
      assert.deepEqual(objects, []);
    });

    await test("objects for one symbol/timeframe never leak into a different symbol or timeframe - real compound-unique-key isolation, not just in-memory keying", async () => {
      await chartDrawingService.save(user.id, "XAUUSD", "1h", [createHorizontalLine(1900, 1000)]);
      await chartDrawingService.save(user.id, "XAUUSD", "4h", [createHorizontalLine(1950, 1000)]);
      const oneHour = await chartDrawingService.get(user.id, "XAUUSD", "1h");
      const fourHour = await chartDrawingService.get(user.id, "XAUUSD", "4h");
      assert.equal(oneHour.length, 1);
      assert.equal(fourHour.length, 1);
      assert.ok(oneHour[0].tool === "horizontal-line" && oneHour[0].price === 1900);
      assert.ok(fourHour[0].tool === "horizontal-line" && fourHour[0].price === 1950);
    });

    await test("objects for one USER never leak into another user's row, even for the identical symbol/timeframe key", async () => {
      const otherUser = await prisma.user.create({ data: { email: `${RUN_TAG}-other@internal.test`, name: "Other User" } });
      try {
        await chartDrawingService.save(otherUser.id, "XAUUSD", "1h", [createHorizontalLine(1, 1)]);
        const mine = await chartDrawingService.get(user.id, "XAUUSD", "1h");
        assert.ok(mine.every((o) => !(o.tool === "horizontal-line" && o.price === 1)), "the other user's object must never appear in my own read");
      } finally {
        await prisma.chartDrawingSet.deleteMany({ where: { userId: otherUser.id } });
        await prisma.user.delete({ where: { id: otherUser.id } });
      }
    });

    await test("get()/save() reject an unknown symbol - never silently persist junk for a symbol the platform doesn't recognize", async () => {
      await assert.rejects(() => chartDrawingService.get(user.id, "NOTAREALSYMBOL", "1h"));
      await assert.rejects(() => chartDrawingService.save(user.id, "NOTAREALSYMBOL", "1h", []));
    });

    await test("get()/save() reject an unknown timeframe - only the real SignalTimeframe set (1m/5m/15m/30m/1h/4h/1d/1w) is accepted", async () => {
      await assert.rejects(() => chartDrawingService.get(user.id, "XAUUSD", "17m"));
      await assert.rejects(() => chartDrawingService.save(user.id, "XAUUSD", "17m", []));
    });

    await test("save() silently drops invalid entries mixed into an otherwise-valid array - the request body is untrusted client input, never a half-formed object reaches the database", async () => {
      const line = createTrendLine({ time: 0, price: 1000 }, { time: 500, price: 1050 }, 1000);
      const junk = [line, { tool: "trendline" }, { not: "an object" }, null];
      await chartDrawingService.save(user.id, "GBPUSD", "1h", junk);
      const objects = await chartDrawingService.get(user.id, "GBPUSD", "1h");
      assert.deepEqual(objects, [line]);
    });

    await test("save() rejects a non-array objects payload outright, distinct from silently dropping invalid array ENTRIES", async () => {
      await assert.rejects(() => chartDrawingService.save(user.id, "GBPUSD", "1h", { not: "an array" }));
    });

    await test("save() rejects a payload exceeding the per-chart object limit - an unbounded array can never be persisted", async () => {
      const many = Array.from({ length: 201 }, (_, i) => createHorizontalLine(i, i));
      await assert.rejects(() => chartDrawingService.save(user.id, "GBPUSD", "1h", many));
    });
  } finally {
    await prisma.chartDrawingSet.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });

    const leftoverDrawings = await prisma.chartDrawingSet.count({ where: { userId: user.id } });
    const leftoverUser = await prisma.user.count({ where: { id: user.id } });
    if (leftoverDrawings > 0 || leftoverUser > 0) {
      console.error(`  WARNING: leftover rows - chartDrawingSet:${leftoverDrawings} users:${leftoverUser}`);
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (user, chart drawing sets)");
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
