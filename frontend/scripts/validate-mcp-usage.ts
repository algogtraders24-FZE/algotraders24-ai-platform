// scripts/validate-mcp-usage.ts
// AT24 MCP v1 - the usage summary builder behind /dashboard/mcp.
// House style (node:assert/strict, tsx). Run: npm run validate:mcp-usage

import assert from "node:assert/strict";
import { buildUsageSummary, nextUtcMidnight } from "../services/mcp/usage";
import { MCP_DAILY_LIMITS } from "../services/mcp/quota";
import { MCP_TOOL_NAMES } from "../services/mcp/mcp-tool-map";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const NOW = new Date("2026-10-07T15:30:00Z");

check("one row per exposed tool, with the real daily limit", () => {
  const s = buildUsageSummary({ serviceEnabled: true, counts: {}, recent: [], now: NOW });
  assert.deepEqual(s.tools.map((t) => t.name), MCP_TOOL_NAMES);
  for (const t of s.tools) {
    assert.equal(t.used, 0);
    assert.equal(t.limit, MCP_DAILY_LIMITS[t.name]);
    assert.equal(t.remaining, t.limit);
  }
});
check("used/remaining computed; remaining never negative; junk counts sanitized", () => {
  const s = buildUsageSummary({ serviceEnabled: true, counts: { quant_backtest: 3, market_intelligence: 999, news_search: -4, risk_calculator: 2.9 }, recent: [], now: NOW });
  const by = Object.fromEntries(s.tools.map((t) => [t.name, t]));
  assert.equal(by.quant_backtest!.used, 3);
  assert.equal(by.quant_backtest!.remaining, MCP_DAILY_LIMITS.quant_backtest - 3);
  assert.equal(by.market_intelligence!.remaining, 0);
  assert.equal(by.news_search!.used, 0);
  assert.equal(by.risk_calculator!.used, 2);
});
check("unknown tool names in counts/recent are ignored (never surfaced)", () => {
  const s = buildUsageSummary({
    serviceEnabled: true,
    counts: { "portfolio.read": 5, place_order: 9 },
    recent: [
      { tool: "portfolio.read", ok: false, errorCode: "unknown_tool", durationMs: 0, createdAt: NOW },
      { tool: "risk_calculator", ok: true, errorCode: null, durationMs: 2.6, createdAt: NOW },
    ],
    now: NOW,
  });
  assert.equal(s.tools.some((t) => t.name === ("portfolio.read" as never)), false);
  assert.equal(s.recent.length, 1);
  assert.equal(s.recent[0]!.tool, "risk_calculator");
  assert.equal(s.recent[0]!.durationMs, 3);
});
check("recent capped at 20 and keeps newest-first order", () => {
  const recent = Array.from({ length: 50 }, (_, i) => ({ tool: "market_snapshot", ok: true, errorCode: null, durationMs: i, createdAt: new Date(NOW.getTime() - i * 1000) }));
  const s = buildUsageSummary({ serviceEnabled: true, counts: {}, recent, now: NOW });
  assert.equal(s.recent.length, 20);
  assert.equal(s.recent[0]!.durationMs, 0);
});
check("only metadata fields are exposed (no args/output keys)", () => {
  const s = buildUsageSummary({ serviceEnabled: false, counts: {}, recent: [{ tool: "risk_calculator", ok: false, errorCode: "invalid_input", durationMs: 1, createdAt: NOW }], now: NOW });
  assert.deepEqual(Object.keys(s.recent[0]!).sort(), ["at", "durationMs", "errorCode", "ok", "tool"]);
  assert.equal(s.serviceEnabled, false);
});
check("resetsAt is the next UTC midnight", () => {
  assert.equal(nextUtcMidnight(NOW).toISOString(), "2026-10-08T00:00:00.000Z");
  assert.equal(nextUtcMidnight(new Date("2026-10-07T00:00:00Z")).toISOString(), "2026-10-08T00:00:00.000Z");
  assert.equal(nextUtcMidnight(new Date("2026-10-07T23:59:59Z")).toISOString(), "2026-10-08T00:00:00.000Z");
});

console.log(`\nvalidate-mcp-usage: ${passed} checks passed`);
