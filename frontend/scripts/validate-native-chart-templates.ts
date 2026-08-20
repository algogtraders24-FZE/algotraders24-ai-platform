// scripts/validate-native-chart-templates.ts
// Sprint D2.7.11 Phase 4 - saved chart templates (MT5's own real Template
// feature). Covers the client-side layer: lib/chart-engine/templates/
// store.ts (fetch-mocked, no real network/DB - see
// validate-chart-template-persistence.ts for the real-DB server-side
// coverage), plus source-text wiring checks for ChartToolbar.tsx/
// NativeChart.tsx/ChartPanel.tsx, matching this codebase's own established
// "no component-rendering framework - read source, assert control-flow
// snippets present" convention for UI wiring (see e.g.
// validate-native-chart-interaction.ts's own nativeChartSrc() helper).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { listTemplates, saveTemplate, deleteTemplate } from "../lib/chart-engine/templates/store";
import { createTrendLine } from "../lib/chart-engine/drawing/types";
import type { DrawingObject } from "../lib/chart-engine/drawing/types";

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

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function installFakeFetch(): void {
  const data = new Map<string, { id: string; name: string; indicatorKeys: string[]; drawingObjects: unknown; updatedAt: string }>();
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/private/chart-templates") {
      if (!init || init.method === undefined) {
        return new Response(JSON.stringify({ status: "ok", data: { templates: [...data.values()] } }), { status: 200 });
      }
      if (init.method === "POST") {
        const body = JSON.parse(String(init.body)) as { name: string; indicatorKeys: string[]; drawingObjects: unknown };
        const existing = [...data.values()].find((t) => t.name === body.name);
        const row = { id: existing?.id ?? `tpl-${data.size + 1}`, name: body.name, indicatorKeys: body.indicatorKeys, drawingObjects: body.drawingObjects, updatedAt: new Date().toISOString() };
        data.set(row.id, row);
        return new Response(JSON.stringify({ status: "ok", data: { template: row } }), { status: 200 });
      }
    }
    const deleteMatch = url.pathname.match(/^\/api\/private\/chart-templates\/(.+)$/);
    if (deleteMatch && init?.method === "DELETE") {
      const id = decodeURIComponent(deleteMatch[1]);
      const existed = data.delete(id);
      return new Response(JSON.stringify({ status: existed ? "ok" : "error" }), { status: existed ? 200 : 404 });
    }
    return new Response(JSON.stringify({ status: "error" }), { status: 404 });
  }) as typeof fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fakeFetch;
}

async function main(): Promise<void> {
  console.log("=== Persistence (templates/store.ts - fetch-mocked, real DB coverage in validate-chart-template-persistence.ts) ===");

  installFakeFetch();

  await test("listTemplates returns an empty array when nothing is saved yet - never throws, never fabricates a default", async () => {
    assert.deepEqual(await listTemplates(), []);
  });

  await test("saveTemplate then listTemplates round-trips the exact name/indicatorKeys/drawingObjects", async () => {
    const line: DrawingObject = createTrendLine({ time: 0, price: 100 }, { time: 500, price: 150 }, 1000);
    const saved = await saveTemplate("Momentum Setup", ["ema-20", "rsi-14"], [line]);
    assert.ok(saved);
    assert.equal(saved!.name, "Momentum Setup");
    assert.deepEqual(saved!.indicatorKeys, ["ema-20", "rsi-14"]);
    assert.deepEqual(saved!.drawingObjects, [line]);

    const all = await listTemplates();
    assert.equal(all.length, 1);
    assert.deepEqual(all[0], saved);
  });

  await test("saveTemplate under an existing name overwrites, never duplicates", async () => {
    await saveTemplate("Momentum Setup", ["macd-12-26-9"], []);
    const all = await listTemplates();
    assert.equal(all.filter((t) => t.name === "Momentum Setup").length, 1);
    assert.deepEqual(all.find((t) => t.name === "Momentum Setup")!.indicatorKeys, ["macd-12-26-9"]);
  });

  await test("deleteTemplate removes it - a subsequent list no longer includes it", async () => {
    const saved = await saveTemplate("Temporary", [], []);
    assert.ok(saved);
    const ok = await deleteTemplate(saved!.id);
    assert.equal(ok, true);
    const all = await listTemplates();
    assert.ok(!all.some((t) => t.id === saved!.id));
  });

  await test("deleteTemplate for a nonexistent id returns false (honest failure), never throws", async () => {
    const ok = await deleteTemplate("does-not-exist");
    assert.equal(ok, false);
  });

  await test("a network/server failure on save resolves to undefined, never a fabricated success - the store never throws either", async () => {
    const win = globalThis as unknown as { fetch: typeof fetch };
    const real = win.fetch;
    win.fetch = (async () => new Response(JSON.stringify({ status: "error" }), { status: 500 })) as typeof fetch;
    try {
      const result = await saveTemplate("Will Fail", [], []);
      assert.equal(result, undefined);
    } finally {
      win.fetch = real;
    }
  });

  console.log("\n=== Wiring (ChartToolbar.tsx / NativeChart.tsx / ChartPanel.tsx) ===");

  await test("ChartToolbar renders a Templates dropdown, distinct from the Indicators dropdown, with its own dismissal state", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    assert.ok(src.includes("templatesMenuOpen"));
    assert.ok(src.includes('aria-label="Chart templates"'));
    assert.ok(src.includes("templatesMenuRef"), "must use its own ref, never reuse the Indicators menu's ref (the two dropdowns must be able to open independently)");
  });

  await test("ChartToolbar's 'Save current as template…' action calls onOpenSaveTemplate and closes the templates menu, never opens a second, hidden state machine", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    const menuBlock = src.slice(src.indexOf('aria-label="Chart templates"'), src.indexOf('aria-label="Chart templates"') + 1500);
    assert.ok(menuBlock.includes("onOpenSaveTemplate()"));
    assert.ok(menuBlock.includes("setTemplatesMenuOpen(false)"));
  });

  await test("ChartToolbar's per-template row wires Apply (name click) and Delete (× button) to their own distinct callbacks - clicking a template's name never also deletes it", () => {
    const src = read("components/chart-engine/ChartToolbar.tsx");
    const menuBlock = src.slice(src.indexOf('aria-label="Chart templates"'), src.indexOf('aria-label="Chart templates"') + 3000);
    assert.ok(menuBlock.includes("onApplyTemplate(tpl)"));
    assert.ok(menuBlock.includes("onDeleteTemplate(tpl.id)"));
  });

  await test("NativeChart's handleApplyTemplate replaces BOTH halves of the bundle - the active indicator set (bubbled up via onApplyIndicatorKeys) AND the current chart's drawn objects (commitDrawingObjects, which also triggers the existing persistence-write effect) - never just one half silently left stale", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const fnBlock = src.slice(src.indexOf("function handleApplyTemplate"), src.indexOf("function handleApplyTemplate") + 400);
    assert.ok(fnBlock.includes("onApplyIndicatorKeys(template.indicatorKeys)"));
    assert.ok(fnBlock.includes("commitDrawingObjects(template.drawingObjects)"));
  });

  await test("NativeChart's handleSaveTemplate saves the CURRENT chart's live state - activeIndicatorKeys (the real prop, not a stale snapshot) and drawingObjectsRef.current (the live ref, not the possibly-stale React state) - matching the same 'refs for live values' discipline this file already applies everywhere else", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const fnBlock = src.slice(src.indexOf("async function handleSaveTemplate"), src.indexOf("async function handleSaveTemplate") + 700);
    assert.ok(fnBlock.includes("Array.from(activeIndicatorKeys)"));
    assert.ok(fnBlock.includes("drawingObjectsRef.current"));
  });

  await test("NativeChart fetches the saved template list once on mount (empty dependency array) - templates are a per-user library, never re-fetched on every symbol/timeframe switch", () => {
    const src = read("components/chart-engine/NativeChart.tsx");
    const effectBlock = src.slice(src.indexOf("listTemplates().then"), src.indexOf("listTemplates().then") + 300);
    assert.ok(effectBlock.includes("}, []);"));
  });

  await test("ChartPanel's applyIndicatorKeys filters to known registry keys only, same discipline toggleIndicator already applies - a template saved with a since-removed indicator key can never resurrect an unknown indicator", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    const fnBlock = src.slice(src.indexOf("function applyIndicatorKeys"), src.indexOf("function applyIndicatorKeys") + 400);
    assert.ok(fnBlock.includes("DEFAULT_INDICATOR_CONFIGS"));
    assert.ok(fnBlock.includes(".filter("));
  });

  await test("ChartPanel passes onApplyIndicatorKeys down to NativeChart, distinct from onToggleIndicator - the two are never conflated into one prop", () => {
    const src = read("components/chart-engine/ChartPanel.tsx");
    assert.ok(src.includes("onApplyIndicatorKeys={applyIndicatorKeys}"));
    assert.ok(src.includes("onToggleIndicator={toggleIndicator}"));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
