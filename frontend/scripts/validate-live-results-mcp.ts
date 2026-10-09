// Validates the MCP tool live_results: input parsing, output contract, compact page (percent-only), catalog entry. Pure.
import assert from "node:assert/strict";
import { liveResultsTool, compactPage, LIVE_RESULTS_TOOL_MAX_PAGES } from "../services/mcp/tools/live-results.tool";
import { buildMcpRegistry } from "../services/mcp/mcp-registry";
import { listMcpTools, MCP_PLAN_GATED_TOOLS } from "../services/mcp/facade";
import { MCP_TOOL_MAP, MCP_TOOL_NAMES } from "../services/mcp/mcp-tool-map";
import { MCP_DAILY_LIMITS } from "../services/mcp/quota";
import { buildPublicResults, type DealWithMagic } from "../services/live-results/build";
import { SUMMARY_DISCLAIMER } from "../services/live-results/summary";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };
const at = (iso: string) => Date.parse(iso + "Z");

// ---- input
const p = (x: unknown) => liveResultsTool.parseInput(x);
eq(p(undefined), { ok: true, value: { limit: 20 } }, "no input = a list of up to 20 pages");
eq(p({}), { ok: true, value: { limit: 20 } }, "empty object = same");
eq(p({ slug: "xxxus30-30684e", limit: 5 }), { ok: true, value: { slug: "xxxus30-30684e", limit: 5 } }, "slug and limit are accepted");
for (const [bad, why] of [
  [{ slug: "Has Space" }, "a slug with spaces"], [{ slug: "../etc/passwd" }, "a path in the slug"], [{ slug: 5 }, "a numeric slug"], [{ slug: "" }, "an empty slug"],
  [{ limit: 0 }, "limit 0"], [{ limit: LIVE_LIMIT() + 1 }, "limit above the cap"], [{ limit: 2.5 }, "fractional limit"], [{ limit: "5" }, "string limit"],
  [{ userId: "u1" }, "a smuggled userId"], [{ visibility: "private" }, "a visibility field"], [{ slug: "ok-slug", key: "secret" }, "an unlisted-page key"], ["x", "a string"], [[1], "an array"],
] as const) ok(!p(bad).ok, `rejects ${why}`);
function LIVE_LIMIT() { return LIVE_RESULTS_TOOL_MAX_PAGES; }

// ---- output contract
ok(liveResultsTool.checkOutput({ mode: "list", disclaimer: SUMMARY_DISCLAIMER, pages: [] }).valid, "a list output with the disclaimer is valid");
ok(!liveResultsTool.checkOutput({ mode: "list", disclaimer: "enjoy", pages: [] }).valid, "an output without the not-verified disclaimer is refused");
ok(!liveResultsTool.checkOutput({ mode: "other", disclaimer: SUMMARY_DISCLAIMER }).valid, "an unknown mode is refused");
ok(!liveResultsTool.checkOutput(null).valid, "a non-object output is refused");

// ---- compact page is percent-only and small
let ms = at("2026-08-01T06:00:00");
let id = 0;
const deal = (x: Partial<DealWithMagic>): DealWithMagic => ({ positionId: "0", timeMsc: (ms += 3_600_000 * 5), symbol: "US30", type: "buy", entry: "in", volume: 1.5, price: 40123.5, commission: -3, swap: 0, profit: 0, fee: 0, comment: "Zenith_Buy", magic: "33302", ...x });
const deals: DealWithMagic[] = [deal({ positionId: "b", type: "balance", entry: "none", symbol: "", volume: 0, price: 0, profit: 10_000, magic: "0", commission: 0 })];
for (let i = 0; i < 400; i++) { const pid = String(++id); deals.push(deal({ positionId: pid }), deal({ positionId: pid, type: "sell", entry: "out", profit: i % 5 === 4 ? -40 : 60, comment: "" })); }
const full = buildPublicResults({
  page: { title: "Zenith", description: "demo EA", showAmounts: true, showBroker: true, positionDelayMin: 15, magicFilter: null },
  account: { mode: "demo", currency: "USD", marginMode: "hedging", leverage: 500, serverUtcOffsetSec: 0, firstSyncAt: at("2026-08-10T00:00:00"), lastSyncAt: at("2026-10-08T11:59:00"), batches: 4, chainHead: "c".repeat(64), broker: "Exness Technologies Ltd" },
  deals, snapshots: [], nowUtc: at("2026-10-08T12:00:00"),
});
ok(full.amounts !== undefined && full.history.rows.length > 0, "precondition: the page itself shows amounts and a history");
const compact = compactPage("zenith-1", full);
const json = JSON.stringify(compact);
eq(compact.mode, "page", "page mode");
ok(compact.disclaimer.includes("NOT independently verified"), "the not-verified disclaimer is in every output");
ok(liveResultsTool.checkOutput(compact).valid, "the compact page passes the output contract");
ok(!/"amounts"|"history"|"openPositions"|"cashflows"|"initialDeposit"|openPrice|closePrice|"volume"|"commission"/.test(json), "no amounts block, history rows, open positions, prices or sizes");
ok(!/\bUSD\b/.test(json.replace(SUMMARY_DISCLAIMER, "")), "no currency anywhere, even though the page itself shows amounts");
ok(json.length < 20_000, `the compact page is small (${json.length} bytes)`);
ok(compact.growth.length > 1 && compact.growth.length <= 60, "growth is cut to 60 points");
ok(compact.months.length > 0 && compact.strategies.length > 0, "months and strategies are present");
eq(compact.summary.broker, "Exness Technologies Ltd", "a broker the owner chose to show is passed on as such");
ok(compact.caveats.length >= 4, "the page's disclosure lines come with it");

// ---- catalog
const reg = buildMcpRegistry();
const listing = listMcpTools(reg).find((t) => t.name === "live_results");
ok(listing !== undefined, "the tool is listed over MCP");
eq(listing!.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, "read-only, not destructive, no external provider");
eq(MCP_TOOL_MAP.live_results, "live_results.read", "name -> internal id");
ok(MCP_TOOL_NAMES.includes("live_results"), "the tool name is in the catalog");
eq(MCP_DAILY_LIMITS.live_results, 200, "a daily limit is enforced");
ok(!MCP_PLAN_GATED_TOOLS.includes("live_results"), "public data: not plan gated");
ok(liveResultsTool.definition.requiredPermissions.length === 0 && liveResultsTool.definition.creditCost.model === "flat", "needs no permission");

console.log(`validate-live-results-mcp: ${checks} checks passed`);
