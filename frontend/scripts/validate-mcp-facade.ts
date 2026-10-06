// scripts/validate-mcp-facade.ts
// AT24 MCP v1 - I1/I2: facade core + pure/adapter tools.
// House style (node:assert/strict, tsx). Run: npm run validate:mcp-facade
//
// Proves (no DB, no network):
//   - risk calculator math (long/short, rounding DOWN, bounds, TP side)
//   - strategy library tool: filters, cap, neutral order, LEGACY label always present
//   - MCP catalog: 7 tools, all read-only, names map 1:1 to the frozen MCP registry
//   - facade: unauthenticated / wrong-scope / unknown tool / kill switch / quota fail-closed
//   - facade REFUSES a tool needing a non-read permission (write-capable tool cannot be exposed)
//   - identity comes from the principal, never from tool args
//   - invalid input, timeout, handler error -> closed-vocabulary errors, no raw text
//   - output size cap; audit carries metadata only (no args/output)

import assert from "node:assert/strict";

import { calculateRisk } from "../services/mcp/risk-calculator";
import { riskCalculatorTool } from "../services/mcp/tools/risk-calculator.tool";
import {
  strategyLibrarySearchTool,
  searchLibrary,
  LIBRARY_TOOL_MAX_RESULTS,
} from "../services/mcp/tools/strategy-library-search.tool";
import { economicCalendarTool } from "../services/mcp/tools/economic-calendar.tool";
import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import type { ToolDefinition, PermissionKey } from "../types/agent-framework/index";
import {
  callMcpTool,
  listMcpTools,
  MCP_READ_PERMISSIONS,
  MCP_MAX_OUTPUT_BYTES,
  type McpAuditRecord,
  type McpPrincipal,
} from "../services/mcp/facade";
import { MCP_TOOL_MAP, MCP_TOOL_NAMES } from "../services/mcp/mcp-tool-map";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

const principal: McpPrincipal = { userId: "user-1", tokenId: "tok-1", scopes: ["read"] };

function fakeTool(id: string, perms: PermissionKey[], handler: ToolImplementation["handler"]): ToolImplementation {
  const definition: ToolDefinition = {
    id,
    name: id,
    description: "fake",
    version: "1.0.0",
    category: "MARKET_DATA",
    inputSchema: { type: "object", additionalProperties: false, properties: { symbol: { type: "string" } } },
    outputSchema: { type: "object" },
    requiredPermissions: perms,
    autonomyFloor: 0,
    creditCost: { model: "flat", credits: 3 },
    executionMode: "sync",
    evidence: { producesEvidence: false, evidenceTypes: [], provenanceProducer: "fake" },
    status: "active",
    wraps: "fake",
  };
  return {
    definition,
    parseInput: (raw) => (typeof raw === "object" && raw !== null ? { ok: true, value: raw } : { ok: false, violations: [{ path: "", message: "bad" }] }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler,
  };
}

async function main() {
  console.log("risk calculator");
  await check("long: 1% of 10000, entry 100 stop 99, $1/pt/lot -> 100 lots", () => {
    const r = calculateRisk({ accountBalance: 10000, riskPercent: 1, entry: 100, stopLoss: 99, valuePerPricePerLot: 1 });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.direction, "long");
      assert.equal(r.value.riskAmount, 100);
      assert.equal(r.value.lots, 100);
    }
  });
  await check("short + TP gives reward:risk", () => {
    const r = calculateRisk({ accountBalance: 10000, riskPercent: 1, entry: 100, stopLoss: 101, takeProfit: 98, valuePerPricePerLot: 1 });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.direction, "short");
      assert.equal(r.value.rewardToRisk, 2);
    }
  });
  await check("lots round DOWN to step; actual risk never exceeds requested", () => {
    const r = calculateRisk({ accountBalance: 10000, riskPercent: 1, entry: 2000, stopLoss: 1990, valuePerPricePerLot: 100, lotStep: 0.01 });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.lots, 0.1);
      assert.ok(r.value.actualRiskAmount <= r.value.riskAmount + 1e-9);
    }
  });
  await check("invalid inputs rejected (0/neg/NaN/Infinity/stop==entry/riskPercent>100/TP wrong side)", () => {
    const base = { accountBalance: 1000, riskPercent: 1, entry: 100, stopLoss: 99, valuePerPricePerLot: 1 };
    for (const bad of [
      { ...base, accountBalance: 0 },
      { ...base, riskPercent: 101 },
      { ...base, riskPercent: -1 },
      { ...base, entry: Number.NaN },
      { ...base, stopLoss: 100 },
      { ...base, valuePerPricePerLot: Number.POSITIVE_INFINITY },
      { ...base, takeProfit: 98 },
      { ...base, lotStep: 0 },
    ]) {
      assert.equal(calculateRisk(bad).ok, false);
    }
  });
  await check("tool parseInput rejects unknown fields and non-numbers", () => {
    assert.equal(riskCalculatorTool.parseInput({ accountBalance: 1, riskPercent: 1, entry: 1, stopLoss: 0.5, valuePerPricePerLot: 1, extra: 1 }).ok, false);
    assert.equal(riskCalculatorTool.parseInput({ accountBalance: "1000", riskPercent: 1, entry: 1, stopLoss: 0.5, valuePerPricePerLot: 1 }).ok, false);
  });

  console.log("strategy library");
  await check("always labelled LEGACY, never 'validated'; neutral id order; cap enforced", async () => {
    const out = searchLibrary({ limit: 5 });
    assert.equal(out.evidenceLabel, "LEGACY-BACKTEST-EVIDENCE");
    assert.match(out.caveat, /Not validated/);
    assert.equal(out.results.length, 5);
    assert.equal(out.results[0]!.id, "lib-1");
    assert.equal(out.totalMatches, 100);
    assert.equal(strategyLibrarySearchTool.parseInput({ limit: LIBRARY_TOOL_MAX_RESULTS + 1 }).ok, false);
    assert.equal(strategyLibrarySearchTool.parseInput({ nope: 1 }).ok, false);
  });
  await check("filters: symbol/timeframe/minTrades narrow results", () => {
    const all = searchLibrary({ limit: 20 });
    const first = all.results[0]!;
    const narrowed = searchLibrary({ symbol: first.symbol, timeframe: first.timeframe, minTrades: first.tradesTotal, limit: 20 });
    assert.ok(narrowed.totalMatches >= 1 && narrowed.totalMatches <= 100);
    for (const r of narrowed.results) {
      assert.ok(r.symbol.toUpperCase().startsWith(first.symbol.toUpperCase()));
      assert.equal(r.timeframe, first.timeframe);
      assert.ok(r.tradesTotal >= first.tradesTotal);
    }
    assert.equal(searchLibrary({ symbol: "NOPE", limit: 5 }).results.length, 0);
  });
  await check("results never include the strategy spec payload", () => {
    const out = searchLibrary({ limit: 1 });
    assert.equal("spec" in out.results[0]!, false);
  });

  console.log("calendar tool input");
  await check("currencies upper-cased; bad impact/unknown field rejected", () => {
    const ok = economicCalendarTool.parseInput({ currencies: ["usd", "eur"], impacts: ["high"] });
    assert.ok(ok.ok);
    if (ok.ok) assert.deepEqual(ok.value.currencies, ["USD", "EUR"]);
    assert.equal(economicCalendarTool.parseInput({ impacts: ["extreme"] }).ok, false);
    assert.equal(economicCalendarTool.parseInput({ week: "next" }).ok, false);
    assert.equal(economicCalendarTool.parseInput({ currencies: ["US$"] }).ok, false);
  });

  console.log("catalog");
  const { buildMcpRegistry } = await import("../services/mcp/mcp-registry");
  await check("real MCP registry builds, is frozen, lists exactly the 7 read-only tools", () => {
    const reg = buildMcpRegistry();
    assert.ok(reg.isFrozen());
    const listing = listMcpTools(reg);
    assert.deepEqual(listing.map((t) => t.name).sort(), [...MCP_TOOL_NAMES].sort());
    assert.equal(listing.length, 7);
    for (const t of listing) {
      assert.equal(t.annotations.readOnlyHint, true);
      assert.equal(t.annotations.destructiveHint, false);
    }
    for (const id of Object.values(MCP_TOOL_MAP)) assert.ok(reg.has(id), `${id} registered`);
  });
  await check("no order/signal permission exists in the external policy", () => {
    for (const forbidden of ["CAN_CREATE_ORDER", "CAN_EXECUTE_ORDER", "CAN_GENERATE_SIGNAL"] as const) {
      assert.equal(MCP_READ_PERMISSIONS.includes(forbidden), false);
    }
    const reg = buildMcpRegistry();
    for (const d of reg.list()) {
      for (const p of d.requiredPermissions) assert.ok(MCP_READ_PERMISSIONS.includes(p), `${d.id} needs ${p}`);
    }
  });

  console.log("facade");
  const audits: McpAuditRecord[] = [];
  const baseDeps = (reg: ToolRegistry) => ({ registry: reg, audit: (r: McpAuditRecord) => void audits.push(r) });
  const realReg = buildMcpRegistry();

  await check("risk_calculator end-to-end through the real gateway", async () => {
    const res = await callMcpTool(baseDeps(realReg), principal, "risk_calculator", {
      accountBalance: 10000, riskPercent: 1, entry: 100, stopLoss: 99, valuePerPricePerLot: 1,
    });
    assert.equal(res.isError, false);
    if (!res.isError) {
      assert.equal((res.data as { lots: number }).lots, 100);
      assert.equal(res.provenance.source, "AT24");
      assert.match(res.disclaimer, /never places orders/);
      assert.equal(res.meta.creditsConsumed, 0);
    }
  });
  await check("strategy_library_search end-to-end carries the legacy label", async () => {
    const res = await callMcpTool(baseDeps(realReg), principal, "strategy_library_search", { limit: 3 });
    assert.equal(res.isError, false);
    if (!res.isError) assert.equal((res.data as { evidenceLabel: string }).evidenceLabel, "LEGACY-BACKTEST-EVIDENCE");
  });
  await check("unauthenticated / wrong scope -> unauthorized (nothing executed)", async () => {
    const a = await callMcpTool(baseDeps(realReg), null, "risk_calculator", {});
    assert.ok(a.isError && a.errorCode === "unauthorized");
    const b = await callMcpTool(baseDeps(realReg), { ...principal, scopes: [] }, "risk_calculator", {});
    assert.ok(b.isError && b.errorCode === "unauthorized");
    const c = await callMcpTool(baseDeps(realReg), { ...principal, userId: "" }, "risk_calculator", {});
    assert.ok(c.isError && c.errorCode === "unauthorized");
  });
  await check("unknown tool / internal AF ids are NOT callable by name", async () => {
    for (const n of ["nope", "market.snapshot", "backtest.run", "portfolio.read", "support.account_read", "place_order", "__proto__", "constructor"]) {
      const res = await callMcpTool(baseDeps(realReg), principal, n, {});
      assert.ok(res.isError && res.errorCode === "unknown_tool", n);
    }
  });
  await check("kill switch fails closed before auth/tool work", async () => {
    const res = await callMcpTool({ ...baseDeps(realReg), killSwitch: () => true }, principal, "risk_calculator", {});
    assert.ok(res.isError && res.errorCode === "service_disabled");
  });
  await check("quota: denied and thrown both fail closed", async () => {
    const denied = await callMcpTool({ ...baseDeps(realReg), quota: { check: async () => ({ allowed: false }) } }, principal, "risk_calculator", {});
    assert.ok(denied.isError && denied.errorCode === "quota_exceeded");
    const thrown = await callMcpTool({ ...baseDeps(realReg), quota: { check: async () => { throw new Error("db down"); } } }, principal, "risk_calculator", {});
    assert.ok(thrown.isError && thrown.errorCode === "quota_exceeded");
  });
  await check("plan-gated quant_backtest: refused with no gate / gate false / gate throws; allowed only when entitled", async () => {
    let ran = 0;
    const reg = new ToolRegistry().register(fakeTool("backtest.run", ["CAN_RUN_BACKTEST"], async () => {
      ran += 1;
      return { output: { ok: true }, evidence: [] };
    })).freeze();
    const noGate = await callMcpTool(baseDeps(reg), principal, "quant_backtest", { symbol: "X" });
    assert.ok(noGate.isError && noGate.errorCode === "plan_required");
    const denied = await callMcpTool({ ...baseDeps(reg), entitlement: { has: async () => false } }, principal, "quant_backtest", { symbol: "X" });
    assert.ok(denied.isError && denied.errorCode === "plan_required");
    const thrown = await callMcpTool({ ...baseDeps(reg), entitlement: { has: async () => { throw new Error("db down"); } } }, principal, "quant_backtest", { symbol: "X" });
    assert.ok(thrown.isError && thrown.errorCode === "plan_required");
    assert.equal(ran, 0, "tool must not run when not entitled");
    const ok = await callMcpTool({ ...baseDeps(reg), entitlement: { has: async (_p, t) => t === "quant_backtest" } }, principal, "quant_backtest", { symbol: "X" });
    assert.equal(ok.isError, false);
    assert.equal(ran, 1);
  });
  await check("non-gated tools do not need an entitlement gate", async () => {
    const res = await callMcpTool(baseDeps(realReg), principal, "risk_calculator", {
      accountBalance: 10000, riskPercent: 1, entry: 100, stopLoss: 99, valuePerPricePerLot: 1,
    });
    assert.equal(res.isError, false);
  });
  await check("invalid args -> invalid_input with no raw detail", async () => {
    const res = await callMcpTool(baseDeps(realReg), principal, "risk_calculator", { accountBalance: -5 });
    assert.ok(res.isError && res.errorCode === "invalid_input");
    if (res.isError) assert.doesNotMatch(res.message, /accountBalance/);
  });

  await check("write-capable / signal tools are REFUSED even if registered", async () => {
    for (const perm of ["CAN_EXECUTE_ORDER", "CAN_CREATE_ORDER", "CAN_GENERATE_SIGNAL"] as PermissionKey[]) {
      const reg = new ToolRegistry();
      let registered = true;
      try {
        reg.register(fakeTool("market.snapshot", [perm], async () => ({ output: {}, evidence: [] })));
      } catch {
        registered = false; // contract may already reject it - equally safe
      }
      if (!registered) continue;
      reg.freeze();
      const res = await callMcpTool(baseDeps(reg), principal, "market_snapshot", { symbol: "X" });
      assert.ok(res.isError && res.errorCode === "tool_not_read_only", perm);
      assert.equal(listMcpTools(reg).length, 0);
    }
  });
  await check("identity comes from the principal, never from args", async () => {
    let seen = "";
    const reg = new ToolRegistry().register(fakeTool("market.snapshot", ["CAN_READ_MARKET_DATA"], async (_i, ctx) => {
      seen = ctx.userId;
      return { output: { ok: true }, evidence: [] };
    })).freeze();
    const res = await callMcpTool(baseDeps(reg), principal, "market_snapshot", { symbol: "X", userId: "attacker", user_id: "attacker" });
    assert.equal(res.isError, false);
    assert.equal(seen, "user-1");
  });
  await check("handler throw -> tool_error (no raw message leaked)", async () => {
    const reg = new ToolRegistry().register(fakeTool("market.snapshot", ["CAN_READ_MARKET_DATA"], async () => {
      throw new Error("SECRET connection string postgres://u:p@h/db");
    })).freeze();
    const res = await callMcpTool(baseDeps(reg), principal, "market_snapshot", { symbol: "X" });
    assert.ok(res.isError && res.errorCode === "tool_error");
    assert.doesNotMatch(JSON.stringify(res), /SECRET|postgres/);
  });
  await check("timeout -> tool_timeout", async () => {
    const reg = new ToolRegistry().register(fakeTool("market.snapshot", ["CAN_READ_MARKET_DATA"], () => new Promise(() => undefined))).freeze();
    const res = await callMcpTool({ ...baseDeps(reg), timeoutMs: 30 }, principal, "market_snapshot", { symbol: "X" });
    assert.ok(res.isError && res.errorCode === "tool_timeout");
  });
  await check("oversize output -> output_too_large", async () => {
    const reg = new ToolRegistry().register(fakeTool("market.snapshot", ["CAN_READ_MARKET_DATA"], async () => ({
      output: { blob: "x".repeat(MCP_MAX_OUTPUT_BYTES + 10) },
      evidence: [],
    }))).freeze();
    const res = await callMcpTool(baseDeps(reg), principal, "market_snapshot", { symbol: "X" });
    assert.ok(res.isError && res.errorCode === "output_too_large");
  });
  await check("audit rows carry metadata only; audit failure never breaks the response", async () => {
    const before = audits.length;
    const res = await callMcpTool(baseDeps(realReg), principal, "risk_calculator", {
      accountBalance: 10000, riskPercent: 1, entry: 100, stopLoss: 99, valuePerPricePerLot: 1,
    });
    assert.equal(res.isError, false);
    const rec = audits[before]!;
    assert.deepEqual(Object.keys(rec).sort(), ["at", "creditsConsumed", "durationMs", "errorCode", "ok", "tokenId", "tool", "userId"].sort());
    assert.doesNotMatch(JSON.stringify(rec), /accountBalance|10000/);
    const failing = await callMcpTool({ registry: realReg, audit: () => { throw new Error("sink down"); } }, principal, "risk_calculator", {
      accountBalance: 10000, riskPercent: 1, entry: 100, stopLoss: 99, valuePerPricePerLot: 1,
    });
    assert.equal(failing.isError, false);
  });

  console.log(`\nvalidate-mcp-facade: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
