// scripts/validate-mcp-server.ts
// AT24 MCP v1 - I3/I4: token auth, quotas and the HTTP handler, driven with
// REAL Request objects through the real MCP SDK transport. No DB, no network:
// stores are in-memory fakes. Run: npm run validate:mcp-server
//
// Proves: token hashing/parsing; auth fails closed (unknown/revoked/expired/
// inactive user/wrong scope/store error); disabled flag, method, Origin, body
// size, burst limit gates; JSON-RPC initialize + tools/list + tools/call over
// the transport; quota enforcement; audit rows metadata-only.

import assert from "node:assert/strict";

import { generateMcpToken, hashMcpToken, parseBearerToken, MCP_TOKEN_PREFIX } from "../services/mcp/token";
import { authenticateBearer, type McpTokenRecord, type McpTokenStore } from "../services/mcp/auth";
import { createBurstLimiter, createDailyQuotaGate, MCP_DAILY_LIMITS, startOfUtcDay } from "../services/mcp/quota";
import { handleMcpHttpRequest, MCP_MAX_BODY_BYTES, type McpHttpDeps } from "../services/mcp/server";
import type { McpAuditRecord } from "../services/mcp/facade";
import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import { riskCalculatorTool } from "../services/mcp/tools/risk-calculator.tool";
import { strategyLibrarySearchTool } from "../services/mcp/tools/strategy-library-search.tool";

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

// Light registry (pure tools only) so the harness never touches providers/DB.
const registry = new ToolRegistry().register(riskCalculatorTool).register(strategyLibrarySearchTool).freeze();

const good = generateMcpToken();
const NOW = new Date("2026-10-06T12:00:00Z");
function record(over: Partial<McpTokenRecord> = {}): McpTokenRecord {
  return { id: "tok-1", userId: "user-1", scopes: ["read"], expiresAt: null, revokedAt: null, userStatus: "active", ...over };
}
function storeFor(rec: McpTokenRecord | null, touched: string[] = []): McpTokenStore {
  return {
    async findByHash(h) {
      return rec && h === good.tokenHash ? rec : null;
    },
    async touchLastUsed(id) {
      touched.push(id);
    },
  };
}

const ACCEPT = "application/json, text/event-stream";
function rpc(body: unknown, headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request("https://algotraders24.ai/api/mcp", {
    method,
    headers: { "content-type": "application/json", accept: ACCEPT, ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}
const bearer = { authorization: `Bearer ${good.raw}` };

function deps(over: Partial<McpHttpDeps> = {}): McpHttpDeps {
  return { enabled: true, registry, tokenStore: storeFor(record()), now: () => NOW, ...over };
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "validate", version: "0" } },
};

async function main() {
  console.log("token primitives");
  await check("generated token: prefix, entropy, only the hash is derivable, hash is stable", () => {
    const a = generateMcpToken();
    const b = generateMcpToken();
    assert.ok(a.raw.startsWith(MCP_TOKEN_PREFIX));
    assert.notEqual(a.raw, b.raw);
    assert.ok(a.raw.length >= 40);
    assert.equal(a.tokenHash, hashMcpToken(a.raw));
    assert.equal(a.tokenHash.length, 64);
    assert.ok(a.raw.startsWith(a.prefix));
    assert.doesNotMatch(a.tokenHash, new RegExp(a.raw.slice(MCP_TOKEN_PREFIX.length, MCP_TOKEN_PREFIX.length + 8)));
  });
  await check("parseBearerToken: strict format only", () => {
    assert.equal(parseBearerToken(`Bearer ${good.raw}`), good.raw);
    for (const bad of [null, undefined, "", "Bearer", `bearer ${good.raw}`, `Basic ${good.raw}`, "Bearer not_our_prefix_abc", `Bearer ${good.raw} extra`, `Bearer ${"a".repeat(500)}`, `Bearer ${MCP_TOKEN_PREFIX}bad token`]) {
      assert.equal(parseBearerToken(bad as string | null | undefined), null, String(bad));
    }
  });

  console.log("authentication (fails closed)");
  await check("valid token -> principal; lastUsed touched best-effort", async () => {
    const touched: string[] = [];
    const p = await authenticateBearer(storeFor(record(), touched), `Bearer ${good.raw}`, NOW);
    assert.deepEqual(p, { userId: "user-1", tokenId: "tok-1", scopes: ["read"] });
    assert.deepEqual(touched, ["tok-1"]);
  });
  await check("unknown / revoked / expired / inactive user / wrong scope / store error -> null", async () => {
    const h = `Bearer ${good.raw}`;
    assert.equal(await authenticateBearer(storeFor(null), h, NOW), null);
    assert.equal(await authenticateBearer(storeFor(record({ revokedAt: new Date("2026-10-01") })), h, NOW), null);
    assert.equal(await authenticateBearer(storeFor(record({ expiresAt: new Date("2026-10-06T12:00:00Z") })), h, NOW), null);
    assert.equal(await authenticateBearer(storeFor(record({ userStatus: "suspended" })), h, NOW), null);
    assert.equal(await authenticateBearer(storeFor(record({ scopes: ["write", "admin"] })), h, NOW), null);
    assert.equal(await authenticateBearer(storeFor(record({ scopes: [] })), h, NOW), null);
    const boom: McpTokenStore = { findByHash: async () => { throw new Error("db down"); }, touchLastUsed: async () => undefined };
    assert.equal(await authenticateBearer(boom, h, NOW), null);
  });
  await check("a write/admin scope is never granted even alongside read", async () => {
    const p = await authenticateBearer(storeFor(record({ scopes: ["read", "write", "admin"] })), `Bearer ${good.raw}`, NOW);
    assert.deepEqual(p?.scopes, ["read"]);
  });

  console.log("quota + burst");
  await check("daily gate: allows under limit, blocks at limit, uses UTC-day start", async () => {
    let seenSince: Date | null = null;
    let count = MCP_DAILY_LIMITS.quant_backtest - 1;
    const gate = createDailyQuotaGate({ countSince: async (_u, _t, since) => { seenSince = since; return count; } }, MCP_DAILY_LIMITS, () => NOW);
    const p = { userId: "u", tokenId: "t", scopes: ["read"] as const };
    assert.equal((await gate.check(p, "quant_backtest")).allowed, true);
    count = MCP_DAILY_LIMITS.quant_backtest;
    assert.equal((await gate.check(p, "quant_backtest")).allowed, false);
    assert.equal(seenSince!.toISOString(), startOfUtcDay(NOW).toISOString());
    assert.equal(startOfUtcDay(NOW).toISOString(), "2026-10-06T00:00:00.000Z");
  });
  await check("burst limiter: blocks over cap, recovers after the window, isolates keys", () => {
    let t = 0;
    const b = createBurstLimiter(3, () => t);
    assert.ok(b.allow("a") && b.allow("a") && b.allow("a"));
    assert.equal(b.allow("a"), false);
    assert.equal(b.allow("other"), true);
    t = 61_000;
    assert.equal(b.allow("a"), true);
  });

  console.log("HTTP handler gates");
  await check("disabled flag -> 503 before anything else", async () => {
    const res = await handleMcpHttpRequest(rpc(INIT, bearer), deps({ enabled: false }));
    assert.equal(res.status, 503);
  });
  await check("non-POST -> 405 with Allow: POST", async () => {
    const res = await handleMcpHttpRequest(rpc(null, bearer, "GET"), deps());
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
    const del = await handleMcpHttpRequest(rpc(null, bearer, "DELETE"), deps());
    assert.equal(del.status, 405);
  });
  await check("any Origin header is rejected unless allow-listed (browser/DNS-rebinding guard)", async () => {
    const res = await handleMcpHttpRequest(rpc(INIT, { ...bearer, origin: "https://evil.example" }), deps());
    assert.equal(res.status, 403);
    const ok = await handleMcpHttpRequest(rpc(INIT, { ...bearer, origin: "https://ok.example" }), deps({ allowedOrigins: ["https://ok.example"] }));
    assert.equal(ok.status, 200);
  });
  await check("oversize body -> 413 (declared and actual); malformed JSON -> 400", async () => {
    const big = await handleMcpHttpRequest(rpc({ pad: "x".repeat(MCP_MAX_BODY_BYTES + 10) }, bearer), deps());
    assert.equal(big.status, 413);
    const bad = await handleMcpHttpRequest(
      new Request("https://algotraders24.ai/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: ACCEPT, ...bearer }, body: "{not json" }),
      deps(),
    );
    assert.equal(bad.status, 400);
  });
  await check("no/invalid/revoked token -> 401 with WWW-Authenticate; no tool work done", async () => {
    const none = await handleMcpHttpRequest(rpc(INIT), deps());
    assert.equal(none.status, 401);
    assert.match(none.headers.get("www-authenticate") ?? "", /Bearer/);
    const wrong = await handleMcpHttpRequest(rpc(INIT, { authorization: `Bearer ${MCP_TOKEN_PREFIX}wrongtoken` }), deps());
    assert.equal(wrong.status, 401);
    const revoked = await handleMcpHttpRequest(rpc(INIT, bearer), deps({ tokenStore: storeFor(record({ revokedAt: NOW })) }));
    assert.equal(revoked.status, 401);
  });
  await check("burst limit -> 429 with Retry-After", async () => {
    const res = await handleMcpHttpRequest(rpc(INIT, bearer), deps({ burst: { allow: () => false } }));
    assert.equal(res.status, 429);
    assert.ok(res.headers.get("retry-after"));
  });

  console.log("MCP protocol over the real transport");
  await check("initialize -> server info + tools capability + instructions", async () => {
    const res = await handleMcpHttpRequest(rpc(INIT, bearer), deps());
    assert.equal(res.status, 200);
    const body = (await res.json()) as { result: { serverInfo: { name: string }; capabilities: { tools: unknown }; instructions: string } };
    assert.equal(body.result.serverInfo.name, "at24-mcp");
    assert.ok(body.result.capabilities.tools);
    assert.match(body.result.instructions, /never places orders/);
  });
  await check("tools/list -> only registered read-only tools, readOnlyHint true, JSON schemas present", async () => {
    const res = await handleMcpHttpRequest(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, bearer), deps());
    const body = (await res.json()) as { result: { tools: { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[] } };
    const names = body.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["risk_calculator", "strategy_library_search"]);
    for (const t of body.result.tools) {
      assert.equal(t.inputSchema.type, "object");
      assert.equal(t.annotations.readOnlyHint, true);
    }
  });
  await check("tools/call risk_calculator -> structured data + provenance + disclaimer; audit is metadata-only", async () => {
    const audits: McpAuditRecord[] = [];
    const res = await handleMcpHttpRequest(
      rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "risk_calculator", arguments: { accountBalance: 10000, riskPercent: 1, entry: 100, stopLoss: 99, valuePerPricePerLot: 1 } } }, bearer),
      deps({ audit: (r) => void audits.push(r) }),
    );
    const body = (await res.json()) as { result: { isError?: boolean; structuredContent: { data: { lots: number }; provenance: { source: string }; disclaimer: string } } };
    assert.notEqual(body.result.isError, true);
    assert.equal(body.result.structuredContent.data.lots, 100);
    assert.equal(body.result.structuredContent.provenance.source, "AT24");
    assert.match(body.result.structuredContent.disclaimer, /not investment advice/i);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.userId, "user-1");
    assert.doesNotMatch(JSON.stringify(audits[0]), /accountBalance|10000/);
  });
  await check("tools/call strategy_library_search carries the LEGACY label through the transport", async () => {
    const res = await handleMcpHttpRequest(rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "strategy_library_search", arguments: { limit: 2 } } }, bearer), deps());
    const body = (await res.json()) as { result: { structuredContent: { data: { evidenceLabel: string; results: unknown[] } } } };
    assert.equal(body.result.structuredContent.data.evidenceLabel, "LEGACY-BACKTEST-EVIDENCE");
    assert.equal(body.result.structuredContent.data.results.length, 2);
  });
  await check("tools/call unknown + internal ids -> isError with closed code (no internals leaked)", async () => {
    for (const name of ["portfolio.read", "place_order", "support.account_read"]) {
      const res = await handleMcpHttpRequest(rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name, arguments: {} } }, bearer), deps());
      const body = (await res.json()) as { result: { isError: boolean; structuredContent: { errorCode: string } } };
      assert.equal(body.result.isError, true);
      assert.equal(body.result.structuredContent.errorCode, "unknown_tool");
    }
  });
  await check("quota exhausted -> isError quota_exceeded; tool never ran", async () => {
    let ran = false;
    const reg = new ToolRegistry().register({ ...riskCalculatorTool, handler: async (...a) => { ran = true; return riskCalculatorTool.handler(...a); } }).freeze();
    const res = await handleMcpHttpRequest(
      rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "risk_calculator", arguments: { accountBalance: 1, riskPercent: 1, entry: 2, stopLoss: 1, valuePerPricePerLot: 1 } } }, bearer),
      deps({ registry: reg, quota: { check: async () => ({ allowed: false }) } }),
    );
    const body = (await res.json()) as { result: { isError: boolean; structuredContent: { errorCode: string } } };
    assert.equal(body.result.structuredContent.errorCode, "quota_exceeded");
    assert.equal(ran, false);
  });
  await check("tool arguments cannot spoof identity (userId in args ignored, strict schema rejects)", async () => {
    const res = await handleMcpHttpRequest(
      rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "risk_calculator", arguments: { accountBalance: 1, riskPercent: 1, entry: 2, stopLoss: 1, valuePerPricePerLot: 1, userId: "victim" } } }, bearer),
      deps(),
    );
    const body = (await res.json()) as { result: { isError: boolean; structuredContent: { errorCode: string } } };
    assert.equal(body.result.structuredContent.errorCode, "invalid_input");
  });

  console.log("real MCP SDK client (what Claude Desktop / Cursor speak)");
  await check("SDK client connects, lists tools and calls one end-to-end via our handler", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const d = deps();
    const transport = new StreamableHTTPClientTransport(new URL("https://algotraders24.ai/api/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${good.raw}` } },
      fetch: (async (input: URL | RequestInfo, init?: RequestInit) => handleMcpHttpRequest(new Request(input as RequestInfo, init), d)) as typeof fetch,
    });
    const client = new Client({ name: "validate-client", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["risk_calculator", "strategy_library_search"]);
    const out = await client.callTool({ name: "risk_calculator", arguments: { accountBalance: 10000, riskPercent: 2, entry: 100, stopLoss: 98, valuePerPricePerLot: 1 } });
    const sc = out.structuredContent as { data: { lots: number; riskAmount: number } };
    assert.equal(sc.data.riskAmount, 200);
    assert.equal(sc.data.lots, 100);
    await client.close();
  });
  await check("SDK client with a bad token cannot connect", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const d = deps();
    const transport = new StreamableHTTPClientTransport(new URL("https://algotraders24.ai/api/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN_PREFIX}nope` } },
      fetch: (async (input: URL | RequestInfo, init?: RequestInit) => handleMcpHttpRequest(new Request(input as RequestInfo, init), d)) as typeof fetch,
    });
    const client = new Client({ name: "validate-client", version: "0" }, { capabilities: {} });
    await assert.rejects(() => client.connect(transport));
    await client.close().catch(() => undefined);
  });

  console.log(`\nvalidate-mcp-server: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
