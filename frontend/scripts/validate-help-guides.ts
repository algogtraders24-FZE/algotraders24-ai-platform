// scripts/validate-help-guides.ts
// In-app how-to guides (/dashboard/help/*). House style (node:assert/strict, tsx).
// Run: npm run validate:help-guides
//
// Proves the guides render, document EVERY exposed AI tool with the real limits,
// reflect the real plan-gating lists, and that nav + feature-page links resolve
// to real routes (no dead links).

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import HelpHub from "../app/dashboard/help/page";
import AiToolsGuide from "../app/dashboard/help/ai-tools/page";
import EdgeGuide from "../app/dashboard/help/edge-analyzer/page";
import { MCP_TOOL_NAMES } from "../services/mcp/mcp-tool-map";
import { MCP_DAILY_LIMITS } from "../services/mcp/quota";
import { FREE_LOCKED_SECTIONS } from "../services/edge-analyzer/access";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}
const html = (c: Parameters<typeof createElement>[0]) => renderToStaticMarkup(createElement(c));
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const root = join(__dirname, "..");

console.log("rendering");
const hub = decode(html(HelpHub));
const ai = decode(html(AiToolsGuide));
const edge = decode(html(EdgeGuide));
check("all three pages render non-empty HTML", () => {
  for (const h of [hub, ai, edge]) assert.ok(h.length > 1000);
});
check("hub links to both guides", () => {
  assert.ok(hub.includes('href="/dashboard/help/edge-analyzer"'));
  assert.ok(hub.includes('href="/dashboard/help/ai-tools"'));
});

console.log("AI Tools guide matches the product");
check("every exposed tool is documented, with its real daily limit", () => {
  for (const name of MCP_TOOL_NAMES) {
    assert.ok(ai.includes(name), `tool missing from guide: ${name}`);
    const row = new RegExp(`${name}[\\s\\S]{0,600}?<td class="py-2">${MCP_DAILY_LIMITS[name]}</td>`);
    assert.match(ai, row, `limit row for ${name}`);
  }
});
check("connect snippet uses the canonical www host and never the bare domain", () => {
  assert.ok(ai.includes("https://www.algotraders24.ai/api/mcp"));
  assert.equal(/https:\/\/algotraders24\.ai\/api\/mcp/.test(ai), false);
});
check("states the safety facts: read-only, no orders, no MT5 key sharing, quant_backtest needs a paid plan, token shown once", () => {
  for (const s of ["never places trades", "Do not share your MT5 API key", "Paid plan (Quant Pro)", "shown only once", "LEGACY-BACKTEST-EVIDENCE", "not affiliated with MetaQuotes"]) {
    assert.ok(ai.includes(s), `missing: ${s}`);
  }
  assert.equal(/validated(?! and)/i.test(ai.replace(/never validated|not validated/gi, "")), false, "must not claim anything is validated");
});

console.log("Edge Analyzer guide matches the product");
check("lists every locked (paid) section from the real gating list", () => {
  for (const s of FREE_LOCKED_SECTIONS) assert.ok(edge.includes(s), `missing locked section: ${s}`);
});
check("explains all six evidence levels and never promises results", () => {
  for (const l of ["Not enough data", "Negative evidence", "No evidence of edge", "Weak evidence", "Moderate evidence", "Strong evidence"]) assert.ok(edge.includes(l), l);
  assert.ok(edge.includes("not investment advice") || edge.includes("Not investment advice"));
  assert.ok(edge.includes("Past results do not predict future results"));
  assert.equal(/guarantee(?!d? about)/i.test(edge.replace(/not a guarantee about the future/gi, "")), false);
});
check("documents privacy, the English-MT5-only limit and the export steps", () => {
  for (const s of ["not saved", "never read", "Only the English MetaTrader 5 report", "Right-click the list", "not affiliated with MetaQuotes"]) assert.ok(edge.includes(s), `missing: ${s}`);
});

console.log("links resolve");
function routeExists(href: string): boolean {
  const dir = join(root, "app", ...href.split("/").filter(Boolean));
  return existsSync(join(dir, "page.tsx"));
}
check("nav, hub and feature-page links point at real pages", () => {
  const nav = readFileSync(join(root, "config", "dashboard.config.ts"), "utf8");
  assert.ok(nav.includes('href: "/dashboard/help"'));
  for (const href of ["/dashboard/help", "/dashboard/help/ai-tools", "/dashboard/help/edge-analyzer", "/dashboard/mcp", "/dashboard/edge-analyzer"]) {
    assert.ok(routeExists(href), `no page for ${href}`);
  }
  assert.ok(readFileSync(join(root, "app/dashboard/mcp/page.tsx"), "utf8").includes('href="/dashboard/help/ai-tools"'));
  assert.ok(readFileSync(join(root, "app/dashboard/edge-analyzer/page.tsx"), "utf8").includes('href="/dashboard/help/edge-analyzer"'));
  // every href rendered inside the guides is an internal route that exists
  for (const h of [hub, ai, edge]) for (const m of h.matchAll(/href="(\/dashboard[^"#?]*)"/g)) assert.ok(routeExists(m[1]!), `dead link: ${m[1]}`);
});

console.log(`\nvalidate-help-guides: ${passed} checks passed`);
