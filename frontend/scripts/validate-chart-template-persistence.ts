// scripts/validate-chart-template-persistence.ts
// Sprint D2.7.11 Phase 4 - saved chart templates (a named, reusable
// bundle of active indicators + drawn objects, MT5's own real Template
// feature). Exercises services/chart/chart-template.service.ts against
// the REAL database (the ChartTemplate table added by this sprint's
// migration), not a fake - same "real data, self-cleaning" convention as
// validate-chart-drawing-persistence.ts. Synthetic
// charttemplate<timestamp>-tagged user, hard-deleted in a `finally`
// block. Client-side store.ts coverage lives in
// validate-native-chart-templates.ts.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { chartTemplateService } from "../services/chart/chart-template.service";
import { createTrendLine, createHorizontalLine } from "../lib/chart-engine/drawing/types";
import { DEFAULT_INDICATOR_CONFIGS } from "../lib/chart-engine/indicators/panel-registry";

const RUN_TAG = `charttemplate-${Date.now()}`;

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
  const user = await prisma.user.create({ data: { email: `${RUN_TAG}@internal.test`, name: "Chart Template Persistence Test User" } });
  const realKeyA = DEFAULT_INDICATOR_CONFIGS[0].key;
  const realKeyB = DEFAULT_INDICATOR_CONFIGS[1].key;

  try {
    await test("list() returns an empty array for a user with nothing saved yet - never throws, never fabricates a default template", async () => {
      const templates = await chartTemplateService.list(user.id);
      assert.deepEqual(templates, []);
    });

    await test("save() then list() round-trips the exact name/indicatorKeys/drawingObjects through a REAL Postgres upsert", async () => {
      const line = createTrendLine({ time: 0, price: 100 }, { time: 500, price: 150 }, 1000);
      const saved = await chartTemplateService.save(user.id, "My Setup", [realKeyA, realKeyB], [line]);
      assert.equal(saved.name, "My Setup");
      assert.deepEqual(saved.indicatorKeys, [realKeyA, realKeyB]);
      assert.deepEqual(saved.drawingObjects, [line]);

      const templates = await chartTemplateService.list(user.id);
      assert.equal(templates.length, 1);
      assert.deepEqual(templates[0], saved);
    });

    await test("save() under an EXISTING name upserts (overwrites), never creates a second row with the same name", async () => {
      const saved = await chartTemplateService.save(user.id, "My Setup", [realKeyA], []);
      assert.deepEqual(saved.indicatorKeys, [realKeyA]);
      assert.deepEqual(saved.drawingObjects, []);

      const templates = await chartTemplateService.list(user.id);
      assert.equal(templates.filter((t) => t.name === "My Setup").length, 1, "must still be exactly one row for this name, not two");
    });

    await test("save() trims the name and rejects an empty/whitespace-only one", async () => {
      const saved = await chartTemplateService.save(user.id, "  Padded Name  ", [], []);
      assert.equal(saved.name, "Padded Name");
      await assert.rejects(() => chartTemplateService.save(user.id, "   ", [], []));
      await assert.rejects(() => chartTemplateService.save(user.id, "", [], []));
    });

    await test("save() silently drops unknown indicator keys and invalid drawing objects - untrusted client input, never a half-formed value reaches the database", async () => {
      const line = createHorizontalLine(200, 1000);
      const saved = await chartTemplateService.save(user.id, "Mixed Junk", [realKeyA, "not-a-real-indicator-key"], [line, { tool: "trendline" }, null]);
      assert.deepEqual(saved.indicatorKeys, [realKeyA]);
      assert.deepEqual(saved.drawingObjects, [line]);
    });

    await test("save() de-duplicates repeated indicator keys", async () => {
      const saved = await chartTemplateService.save(user.id, "Dupes", [realKeyA, realKeyA, realKeyB, realKeyA], []);
      assert.deepEqual(saved.indicatorKeys, [realKeyA, realKeyB]);
    });

    await test("save() rejects non-array indicatorKeys/drawingObjects outright", async () => {
      await assert.rejects(() => chartTemplateService.save(user.id, "Bad Shape", { not: "an array" }, []));
      await assert.rejects(() => chartTemplateService.save(user.id, "Bad Shape 2", [], { not: "an array" }));
    });

    await test("save() rejects a name exceeding the character limit", async () => {
      await assert.rejects(() => chartTemplateService.save(user.id, "x".repeat(61), [], []));
    });

    await test("delete() removes the row, and a second delete() of the same id honestly 404s rather than silently succeeding twice", async () => {
      const saved = await chartTemplateService.save(user.id, "To Delete", [], []);
      await chartTemplateService.delete(user.id, saved.id);
      const templates = await chartTemplateService.list(user.id);
      assert.ok(!templates.some((t) => t.id === saved.id));
      await assert.rejects(() => chartTemplateService.delete(user.id, saved.id));
    });

    await test("delete() for another user's template 404s (never a distinct 403) - ownership scoped directly in the query, same 'indistinguishable from nonexistent' rule this codebase applies to every owned resource", async () => {
      const otherUser = await prisma.user.create({ data: { email: `${RUN_TAG}-other@internal.test`, name: "Other User" } });
      try {
        const theirs = await chartTemplateService.save(otherUser.id, "Theirs", [], []);
        await assert.rejects(() => chartTemplateService.delete(user.id, theirs.id));
        const stillThere = await chartTemplateService.list(otherUser.id);
        assert.ok(stillThere.some((t) => t.id === theirs.id), "the other user's template must survive an unauthorized delete attempt");
      } finally {
        await prisma.chartTemplate.deleteMany({ where: { userId: otherUser.id } });
        await prisma.user.delete({ where: { id: otherUser.id } });
      }
    });

    await test("save() rejects once a user reaches the per-user template limit (a genuinely NEW name, not an overwrite of an existing one)", async () => {
      const before = await chartTemplateService.list(user.id);
      for (const t of before) await prisma.chartTemplate.delete({ where: { id: t.id } });
      for (let i = 0; i < 50; i++) await chartTemplateService.save(user.id, `Limit Test ${i}`, [], []);
      await assert.rejects(() => chartTemplateService.save(user.id, "One Too Many", [], []));
      // Overwriting an EXISTING name at the limit must still succeed - the limit guards against unbounded NEW rows, never against updating one already owned.
      const overwritten = await chartTemplateService.save(user.id, "Limit Test 0", [realKeyA], []);
      assert.deepEqual(overwritten.indicatorKeys, [realKeyA]);
    });
  } finally {
    await prisma.chartTemplate.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });

    const leftoverTemplates = await prisma.chartTemplate.count({ where: { userId: user.id } });
    const leftoverUser = await prisma.user.count({ where: { id: user.id } });
    if (leftoverTemplates > 0 || leftoverUser > 0) {
      console.error(`  WARNING: leftover rows - chartTemplate:${leftoverTemplates} users:${leftoverUser}`);
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (user, chart templates)");
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
