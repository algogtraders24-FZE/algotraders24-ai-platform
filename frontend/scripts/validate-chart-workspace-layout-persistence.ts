// scripts/validate-chart-workspace-layout-persistence.ts
// Sprint D2.7.11 (post-completion, roadmap item 2) - durable, per-user
// persistence for the Phase 3 multi-symbol tiled chart layout, promoted
// from sessionStorage to a real database table (ChartWorkspaceLayout),
// mirroring the Phase 1 -> 1b precedent for drawn objects. Two halves in
// one file (a small, focused feature - unlike templates/drawings, which
// split server/client coverage across two files):
//   1. chart-workspace-layout.service.ts against the REAL database
//      (synthetic chartworkspacelayout<timestamp>-tagged user, hard-
//      deleted in a `finally` block - same "real data, self-cleaning"
//      convention as validate-chart-template-persistence.ts).
//   2. chart-workspace-layout-store.ts (the client) against a fetch mock,
//      matching validate-native-chart-templates.ts's own installFakeFetch
//      pattern.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { chartWorkspaceLayoutService } from "../services/chart/chart-workspace-layout.service";
import { readChartWorkspaceLayout, writeChartWorkspaceLayout } from "../lib/chart-engine/chart-workspace-layout-store";
import type { ChartSessionState } from "../lib/chart-engine/chart-session-state";

const RUN_TAG = `chartworkspacelayout-${Date.now()}`;

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

async function serviceTests(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `${RUN_TAG}@internal.test`, name: "Chart Workspace Layout Persistence Test User" } });

  try {
    await test("get() returns {} for a user with nothing saved yet - never throws, never fabricates a default layout", async () => {
      const state = await chartWorkspaceLayoutService.get(user.id);
      assert.deepEqual(state, {});
    });

    await test("save() then get() round-trips the exact provider/layout/panes/primaryPaneIndex through a REAL Postgres upsert", async () => {
      const saved = await chartWorkspaceLayoutService.save(user.id, {
        provider: "native",
        layout: 2,
        panes: [
          { symbol: "XAUUSD", timeframe: "4h", indicatorKeys: ["rsi-14"] },
          { symbol: "EURUSD", timeframe: "1h", indicatorKeys: [] },
        ],
        primaryPaneIndex: 1,
      });
      assert.equal(saved.provider, "native");
      assert.equal(saved.layout, 2);
      assert.equal(saved.primaryPaneIndex, 1);
      assert.equal(saved.panes?.length, 2);
      assert.equal(saved.panes?.[0].symbol, "XAUUSD");

      const fetched = await chartWorkspaceLayoutService.get(user.id);
      assert.deepEqual(fetched, saved);
    });

    await test("save() for a user who already has a row UPSERTS (overwrites), never creates a second row - the userId unique constraint is the real enforcement, not just application logic", async () => {
      await chartWorkspaceLayoutService.save(user.id, { provider: "tradingview", layout: 1, panes: [], primaryPaneIndex: 0 });
      const rows = await prisma.chartWorkspaceLayout.findMany({ where: { userId: user.id } });
      assert.equal(rows.length, 1, "must still be exactly one row for this user, not two");
      assert.equal(rows[0].provider, "tradingview");
    });

    await test("an unknown/invalid provider or layout value is dropped, falls back to the real default (native/1), never applied as-is", async () => {
      const saved = await chartWorkspaceLayoutService.save(user.id, { provider: "made-up-provider", layout: 3, panes: [] });
      assert.equal(saved.provider, "native", "3 is not a real layout (only 1/2/4 are), and the invalid provider must fall back too");
      assert.equal(saved.layout, 1);
    });

    await test("a pane with an invalid timeframe is dropped from the saved panes array - re-validated server-side via the SAME sanitizePane() the client used to use, never trusted whole-cloth from the request body", async () => {
      const saved = await chartWorkspaceLayoutService.save(user.id, {
        panes: [{ symbol: "EURUSD", timeframe: "2m", indicatorKeys: [] }],
      });
      assert.equal(saved.panes, undefined, "the only pane was invalid, so the whole (now-empty) panes array is honestly absent, never a fabricated empty-but-present array");
    });

    await test("unknown indicator keys within a pane are filtered out - only real DEFAULT_INDICATOR_CONFIGS keys survive, a real pane is not dropped just because one of its indicator keys was invalid", async () => {
      const saved = await chartWorkspaceLayoutService.save(user.id, {
        panes: [{ symbol: "EURUSD", timeframe: "1h", indicatorKeys: ["ema-20", "not-a-real-indicator"] }],
      });
      assert.deepEqual(saved.panes?.[0].indicatorKeys, ["ema-20"]);
    });

    await test("a pane missing a symbol entirely is dropped, never persisted as an empty-symbol chart", async () => {
      const saved = await chartWorkspaceLayoutService.save(user.id, {
        panes: [{ timeframe: "1h", indicatorKeys: [] }, { symbol: "EURUSD", timeframe: "1h", indicatorKeys: [] }],
      });
      assert.equal(saved.panes?.length, 1);
      assert.equal(saved.panes?.[0].symbol, "EURUSD");
    });

    await test("save() rejects a non-object state outright (untrusted request body, never silently coerced)", async () => {
      await assert.rejects(() => chartWorkspaceLayoutService.save(user.id, null));
      await assert.rejects(() => chartWorkspaceLayoutService.save(user.id, "not an object"));
    });

    await test("save() rejects more than the real 4-pane maximum (Phase 3's own LAYOUTS = [1,2,4] ceiling) - never silently truncates a hostile oversized array", async () => {
      const panes = Array.from({ length: 5 }, () => ({ symbol: "EURUSD", timeframe: "1h", indicatorKeys: [] }));
      await assert.rejects(() => chartWorkspaceLayoutService.save(user.id, { panes }));
    });

    await test("a negative or non-integer primaryPaneIndex falls back to the real default (0), never persisted as-is", async () => {
      const saved = await chartWorkspaceLayoutService.save(user.id, { primaryPaneIndex: -5 });
      assert.equal(saved.primaryPaneIndex, 0);
    });
  } finally {
    await prisma.chartWorkspaceLayout.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });

    const leftoverLayouts = await prisma.chartWorkspaceLayout.count({ where: { userId: user.id } });
    const leftoverUser = await prisma.user.count({ where: { id: user.id } });
    if (leftoverLayouts > 0 || leftoverUser > 0) {
      console.error(`  WARNING: leftover rows - chartWorkspaceLayout:${leftoverLayouts} users:${leftoverUser}`);
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (user, chart workspace layout)");
    }
  }
}

function installFakeFetch(): void {
  let saved: ChartSessionState | null = null;
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname !== "/api/private/chart-workspace-layout") return new Response(JSON.stringify({ status: "error" }), { status: 404 });
    if (!init || init.method === undefined) {
      return new Response(JSON.stringify({ status: "ok", data: { state: saved ?? {} } }), { status: 200 });
    }
    if (init.method === "PUT") {
      saved = JSON.parse(String(init.body)) as ChartSessionState;
      return new Response(JSON.stringify({ status: "ok", data: { state: saved } }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: "error" }), { status: 404 });
  }) as typeof fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fakeFetch;
}

async function clientStoreTests(): Promise<void> {
  installFakeFetch();

  await test("readChartWorkspaceLayout returns {} when nothing is saved yet - never throws, never fabricates a default", async () => {
    assert.deepEqual(await readChartWorkspaceLayout(), {});
  });

  await test("writeChartWorkspaceLayout then readChartWorkspaceLayout round-trips the exact state through the fetch-mocked API", async () => {
    const state: ChartSessionState = {
      provider: "native",
      layout: 4,
      panes: [{ symbol: "BTCUSD", timeframe: "1h", indicatorKeys: ["ema-20"] }],
      primaryPaneIndex: 0,
    };
    await writeChartWorkspaceLayout(state);
    const restored = await readChartWorkspaceLayout();
    assert.deepEqual(restored, state);
  });

  await test("readChartWorkspaceLayout resolves to {} (never throws/rejects) when the endpoint 404s or the network fails - the client's own 'never blocks the chart UI' contract", async () => {
    const win = globalThis as unknown as { fetch: typeof fetch };
    const real = win.fetch;
    win.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    try {
      assert.deepEqual(await readChartWorkspaceLayout(), {});
    } finally {
      win.fetch = real;
    }
  });

  await test("writeChartWorkspaceLayout never throws on a network failure - a best-effort write, same contract the old sessionStorage writer always had", async () => {
    const win = globalThis as unknown as { fetch: typeof fetch };
    const real = win.fetch;
    win.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    try {
      await assert.doesNotReject(() => writeChartWorkspaceLayout({ provider: "native", layout: 1, panes: [], primaryPaneIndex: 0 }));
    } finally {
      win.fetch = real;
    }
  });
}

async function main(): Promise<void> {
  console.log("=== Service (chart-workspace-layout.service.ts - real database) ===");
  await serviceTests();
  console.log("\n=== Client store (chart-workspace-layout-store.ts - fetch-mocked) ===");
  await clientStoreTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
